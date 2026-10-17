// @effect-diagnostics preferSchemaOverJson:off -- Recorded frames are plain JSON values.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  encodeProviderReplayNdjson,
  type ProviderReplayEntry,
} from "@playstead/provider-testing/replayTranscript";
import { withoutAgentShellVariables } from "@playstead/shared/agentShell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  ClaudeAgentSdkQueryRunner,
  layerQueryRunner,
} from "../src/orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import {
  CLAUDE_REPLAY_PROTOCOL,
  CLAUDE_REPLAY_PROVIDER,
  makeRecordingQueryRunner,
} from "../src/orchestration-v2/Adapters/ClaudeAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "../src/orchestration-v2/testkit/OrchestratorHarness.ts";
import {
  CLAUDE_AUTO_MODE_SCENARIO,
  runAutoModeScenario,
} from "../src/orchestration-v2/testkit/fixtures/autoMode.ts";
import {
  FILE_CREATE_SCENARIO,
  runFileCreateScenario,
} from "../src/orchestration-v2/testkit/fixtures/fileCreate.ts";
import {
  CLAUDE_QUESTION_SCENARIO,
  QUESTION_ANSWER_SCENARIO_NAME,
  QUESTION_INTERRUPT_SCENARIO_NAME,
  runQuestionAnswerScenario,
  runQuestionInterruptScenario,
} from "../src/orchestration-v2/testkit/fixtures/questionAnswer.ts";
import {
  RESTART_RESUME_IDS,
  RESTART_RESUME_SCENARIO,
  runFirstTurn,
  runSecondTurn,
} from "../src/orchestration-v2/testkit/fixtures/restartResume.ts";
import {
  CLAUDE_TURN_INTERRUPT_SCENARIO,
  runTurnInterruptScenario,
} from "../src/orchestration-v2/testkit/fixtures/turnInterrupt.ts";
import {
  CLAUDE_TRAITS_CHANGE_SCENARIO,
  runTraitsChangeScenario,
} from "../src/orchestration-v2/testkit/fixtures/traitsChange.ts";
import {
  readMachineIdentity,
  recordingReplacements,
  type Replacements,
  scrubbed,
  scrubbedText,
  writeRecording,
} from "../src/orchestration-v2/testkit/replayScrub.ts";
import { makeTestServerConfig } from "../src/testUtils/testServer.ts";

/**
 * Playstead's Claude Agent SDK recorder (T3 Code's
 * `apps/server/scripts/record-claude-agent-sdk-replay-fixture.ts` at 2577baf
 * records by hand-driving `query()`; this one runs the Seam 1 scenario
 * through Playstead's own adapter, so a recording is exactly what the
 * adapter sends). It uses the signed-in `claude` on PATH, in a temporary
 * empty folder, and writes `src/orchestration-v2/testkit/fixtures/<scenario>.claude.ndjson`.
 *
 *   node apps/server/scripts/record-claude-replay.ts [file_create | restart_resume | turn_interrupt | question_answer | question_interrupt | auto_mode | traits_change]
 *
 * `auto_mode` writes a file in Auto, then changes the thread to Full access,
 * which reopens the query with `resume`, and sends one more message.
 * `restart_resume` builds the services a second time over the same home
 * between its two turns, as a restarted server would. `turn_interrupt`
 * interrupts a long command once it runs, then sends one more message.
 * `question_answer` answers Claude's `AskUserQuestion` through
 * `runtime-request.respond`; `question_interrupt` interrupts the turn
 * waiting on it instead. `traits_change` sends turns that each carry other
 * reasoning efforts.
 *
 * The header carries `claude --version` and the capture date. The frames are
 * scrubbed by `src/orchestration-v2/testkit/replayScrub.ts`, shared with the
 * Codex recorder, which also refuses to write a file that still names this
 * machine or an account.
 */

const claudeVersion = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const output = yield* spawner.string(ChildProcess.make("claude", ["--version"]));
  const version = /\b(\d+\.\d+\.\d+)\b/.exec(output)?.[1];
  if (version === undefined) return yield* Effect.die(`claude --version printed: ${output}`);
  return version;
});

interface StreamedPiece {
  readonly at: number;
  readonly field: "partial_json" | "text";
  readonly text: string;
}

const deltaField = (delta: Record<string, unknown>) =>
  delta["type"] === "input_json_delta"
    ? ("partial_json" as const)
    : delta["type"] === "text_delta"
      ? ("text" as const)
      : undefined;

/**
 * A streamed block arrives in pieces, and a path can be split between two of
 * them, out of reach of a string replacement. Each block's pieces are joined
 * and scrubbed; when that changes anything, the whole scrubbed text goes in
 * the first piece and the rest are left empty. The block's text is the same.
 */
const collapseScrubbedDeltas = (
  recorded: ReadonlyArray<ProviderReplayEntry>,
  replacements: Replacements,
): ReadonlyArray<ProviderReplayEntry> => {
  const blocks = new Map<string, Array<StreamedPiece>>();
  let messageId = "";
  recorded.forEach((item, at) => {
    if (item.type !== "emit_inbound") return;
    const frame = item.frame as {
      readonly type?: unknown;
      readonly event?: Record<string, unknown>;
    };
    if (frame.type !== "stream_event" || frame.event === undefined) return;
    const event = frame.event;
    if (event["type"] === "message_start") {
      messageId = String((event["message"] as { readonly id?: unknown } | undefined)?.id ?? "");
    }
    if (event["type"] !== "content_block_delta") return;
    const delta = event["delta"] as Record<string, unknown>;
    const field = deltaField(delta);
    const text = field === undefined ? undefined : delta[field];
    if (field === undefined || typeof text !== "string") return;
    const key = `${messageId}:${String(event["index"])}`;
    const pieces = blocks.get(key) ?? [];
    pieces.push({ at, field, text });
    blocks.set(key, pieces);
  });
  const rewritten = new Map<number, string>();
  for (const pieces of blocks.values()) {
    const joined = pieces.map((piece) => piece.text).join("");
    const clean = scrubbedText(joined, replacements);
    if (clean === joined) continue;
    pieces.forEach((piece, position) => rewritten.set(piece.at, position === 0 ? clean : ""));
  }
  return recorded.map((item, at) => {
    const text = rewritten.get(at);
    if (text === undefined) return item;
    const frame = item.frame as { readonly event: { readonly delta: Record<string, unknown> } };
    const field = deltaField(frame.event.delta) ?? "text";
    return {
      ...item,
      frame: {
        ...frame,
        event: { ...frame.event, delta: { ...frame.event.delta, [field]: text } },
      },
    };
  });
};

/**
 * Claude Code's start-up message lists this machine's tools, MCP servers,
 * plugins, skills and memory files; the adapter reads none of it. Keep its
 * shape and drop the lists, as T3 Code's `sanitizeSdkMessageForReplay` does.
 */
const trimmedInbound = (frame: unknown): unknown => {
  if (typeof frame !== "object" || frame === null) return frame;
  const type: unknown = Reflect.get(frame, "type");
  const subtype: unknown = Reflect.get(frame, "subtype");
  if (type === "system" && subtype === "init") {
    const keep = new Set([
      "type",
      "subtype",
      "uuid",
      "session_id",
      "model",
      "cwd",
      "permissionMode",
      "claude_code_version",
    ]);
    return Object.fromEntries(Object.entries(frame).filter(([key]) => keep.has(key)));
  }
  if (type === "rate_limit_event") {
    return Object.fromEntries(
      Object.entries(frame).filter(([key]) => ["type", "uuid", "session_id"].includes(key)),
    );
  }
  return frame;
};

/**
 * Claude Code keeps sending bookkeeping after the last turn's `result`
 * (`command_lifecycle`, for one). Nothing waits for it, so a replay could
 * not tell whether it was read before the test ends; it is left out.
 */
const untilLastResult = (recorded: ReadonlyArray<ProviderReplayEntry>) => {
  const last = recorded.findLastIndex(
    (entry) =>
      entry.type === "emit_inbound" &&
      typeof entry.frame === "object" &&
      entry.frame !== null &&
      Reflect.get(entry.frame, "type") === "result",
  );
  return last < 0 ? recorded : recorded.slice(0, last + 1);
};

type HarnessOptions = Parameters<typeof makeOrchestrationHarness>[0];

/** One file-creating turn. */
const recordFileCreate = (options: HarnessOptions) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const harness = yield* makeOrchestrationHarness(options);
    const { workspace, run } = yield* runFileCreateScenario(harness);
    const written = path.join(workspace, FILE_CREATE_SCENARIO.fileName);
    yield* Effect.logInfo("The turn ended.").pipe(
      Effect.annotateLogs({
        run: run.status,
        file: (yield* fs.exists(written))
          ? JSON.stringify(yield* fs.readFileString(written))
          : "missing",
      }),
    );
    if (run.status !== "completed") return yield* Effect.die(`The run ended ${run.status}.`);
    return { harness, workspace };
  });

/** A turn interrupted while its command runs, then a turn after it. */
const recordTurnInterrupt = (options: HarnessOptions) =>
  Effect.gen(function* () {
    const harness = yield* makeOrchestrationHarness(options);
    const { workspace, first, next } = yield* runTurnInterruptScenario(
      harness,
      CLAUDE_TURN_INTERRUPT_SCENARIO,
    );
    yield* Effect.logInfo("The turns ended.").pipe(
      Effect.annotateLogs({ first: first.status, next: next.status }),
    );
    if (first.status !== "interrupted" || next.status !== "completed") {
      return yield* Effect.die(`The runs ended ${first.status} and ${next.status}.`);
    }
    return { harness, workspace };
  });

/** Claude asks, and the question is answered, or its turn interrupted. */
const recordQuestion = (options: HarnessOptions, interrupt: boolean) =>
  Effect.gen(function* () {
    const harness = yield* makeOrchestrationHarness(options);
    const { workspace, pending, run } = yield* (
      interrupt ? runQuestionInterruptScenario : runQuestionAnswerScenario
    )(harness, CLAUDE_QUESTION_SCENARIO);
    yield* Effect.logInfo("The turn ended.").pipe(
      Effect.annotateLogs({ run: run.status, questions: JSON.stringify(pending.item.questions) }),
    );
    if (run.status !== (interrupt ? "interrupted" : "completed")) {
      return yield* Effect.die(`The run ended ${run.status}.`);
    }
    return { harness, workspace };
  });

/** A turn, a restart over the same home, and a turn that needs the first one's context. */
const recordRestartResume = (options: HarnessOptions) =>
  Effect.gen(function* () {
    const config = yield* makeTestServerConfig();
    const first = yield* Effect.scoped(
      Effect.flatMap(makeOrchestrationHarness({ ...options, config }), runFirstTurn),
    );
    if (first.run.status !== "completed") {
      return yield* Effect.die(`The first run ended ${first.run.status}.`);
    }
    const harness = yield* makeOrchestrationHarness({ ...options, config, recoverOnStartup: true });
    const second = yield* runSecondTurn(harness);
    const projection = yield* harness.orchestrator.getThreadProjection(RESTART_RESUME_IDS.threadId);
    const reply =
      projection._tag === "Some"
        ? projection.value.messages.findLast((message) => message.role === "assistant")?.text
        : undefined;
    yield* Effect.logInfo("The turn after the restart ended.").pipe(
      Effect.annotateLogs({ run: second.status, reply: JSON.stringify(reply) }),
    );
    if (second.status !== "completed" || !reply?.toLowerCase().includes("tangerine")) {
      return yield* Effect.die("Claude did not remember the code word after the restart.");
    }
    return { harness, workspace: first.workspace };
  });

/** Turns that each carry other traits. */
const recordTraitsChange = (options: HarnessOptions) =>
  Effect.gen(function* () {
    const harness = yield* makeOrchestrationHarness(options);
    const { workspace, runs } = yield* runTraitsChangeScenario(
      harness,
      CLAUDE_TRAITS_CHANGE_SCENARIO,
    );
    yield* Effect.logInfo("The turns ended.").pipe(
      Effect.annotateLogs({ runs: runs.map((run) => run.status).join(", ") }),
    );
    if (runs.some((run) => run.status !== "completed")) {
      return yield* Effect.die("A traits turn did not complete.");
    }
    return { harness, workspace };
  });

/** A file written in Auto, then a turn after the change to Full access. */
const recordAutoMode = (options: HarnessOptions) =>
  Effect.gen(function* () {
    const harness = yield* makeOrchestrationHarness(options);
    const { workspace, write, next } = yield* runAutoModeScenario(
      harness,
      CLAUDE_AUTO_MODE_SCENARIO,
    );
    yield* Effect.logInfo("The turns ended.").pipe(
      Effect.annotateLogs({ write: write.status, next: next.status }),
    );
    if (write.status !== "completed" || next.status !== "completed") {
      return yield* Effect.die(`The runs ended ${write.status} and ${next.status}.`);
    }
    return { harness, workspace };
  });

/** Each scenario: how it is recorded, and what the header says about it. */
const SCENARIOS = {
  [CLAUDE_TRAITS_CHANGE_SCENARIO.scenario]: {
    record: recordTraitsChange,
    metadata: {
      model: CLAUDE_TRAITS_CHANGE_SCENARIO.model,
      turns: CLAUDE_TRAITS_CHANGE_SCENARIO.turns,
    },
  },
  [CLAUDE_AUTO_MODE_SCENARIO.scenario]: {
    record: recordAutoMode,
    metadata: {
      model: CLAUDE_AUTO_MODE_SCENARIO.model,
      prompts: [CLAUDE_AUTO_MODE_SCENARIO.writePrompt, CLAUDE_AUTO_MODE_SCENARIO.nextPrompt],
      runtimeModes: ["auto", "full-access"],
    },
  },
  [FILE_CREATE_SCENARIO.scenario]: {
    record: recordFileCreate,
    metadata: { model: FILE_CREATE_SCENARIO.model, prompt: FILE_CREATE_SCENARIO.prompt },
  },
  [RESTART_RESUME_SCENARIO.scenario]: {
    record: recordRestartResume,
    metadata: {
      model: RESTART_RESUME_SCENARIO.model,
      prompts: [RESTART_RESUME_SCENARIO.firstPrompt, RESTART_RESUME_SCENARIO.secondPrompt],
    },
  },
  [CLAUDE_TURN_INTERRUPT_SCENARIO.scenario]: {
    record: recordTurnInterrupt,
    metadata: {
      model: CLAUDE_TURN_INTERRUPT_SCENARIO.model,
      prompts: [
        CLAUDE_TURN_INTERRUPT_SCENARIO.longPrompt,
        CLAUDE_TURN_INTERRUPT_SCENARIO.nextPrompt,
      ],
      interruptAfter: "command_execution running",
    },
  },
  [QUESTION_ANSWER_SCENARIO_NAME]: {
    record: (options: HarnessOptions) => recordQuestion(options, false),
    metadata: {
      model: CLAUDE_QUESTION_SCENARIO.model,
      prompt: CLAUDE_QUESTION_SCENARIO.prompt,
      answer: CLAUDE_QUESTION_SCENARIO.answer,
    },
  },
  [QUESTION_INTERRUPT_SCENARIO_NAME]: {
    record: (options: HarnessOptions) => recordQuestion(options, true),
    metadata: {
      model: CLAUDE_QUESTION_SCENARIO.model,
      prompt: CLAUDE_QUESTION_SCENARIO.prompt,
      interruptAfter: "user_input pending",
    },
  },
};

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scenarioName = process.argv[2] ?? FILE_CREATE_SCENARIO.scenario;
  const scenario = Object.hasOwn(SCENARIOS, scenarioName)
    ? SCENARIOS[scenarioName as keyof typeof SCENARIOS]
    : undefined;
  if (scenario === undefined) {
    return yield* Effect.die(
      `No scenario is called ${scenarioName}. The scenarios are ${Object.keys(SCENARIOS).join(", ")}.`,
    );
  }
  const version = yield* claudeVersion;
  const sdkEntry = yield* path.fromFileUrl(
    new URL(import.meta.resolve("@anthropic-ai/claude-agent-sdk")),
  );
  const sdkVersion = String(
    (
      JSON.parse(yield* fs.readFileString(path.join(path.dirname(sdkEntry), "package.json"))) as {
        readonly version: unknown;
      }
    ).version,
  );

  const real = yield* Effect.gen(function* () {
    return yield* ClaudeAgentSdkQueryRunner;
  }).pipe(Effect.provide(layerQueryRunner));
  const recording = makeRecordingQueryRunner(real);
  const { harness, workspace } = yield* scenario.record({
    claudeRunner: recording.runner,
    claudeBinaryPath: "claude",
    environment: withoutAgentShellVariables(process.env),
  });

  const machine = readMachineIdentity();
  const replacements = recordingReplacements({ workspace, playsteadHome: harness.home, machine });
  const entries: Array<ProviderReplayEntry> = collapseScrubbedDeltas(
    untilLastResult(recording.entries),
    replacements,
  ).map((entry) => ({
    ...entry,
    frame: scrubbed(
      entry.type === "emit_inbound" ? trimmedInbound(entry.frame) : entry.frame,
      replacements,
    ),
  }));
  const text = encodeProviderReplayNdjson({
    header: {
      type: "transcript_start",
      provider: CLAUDE_REPLAY_PROVIDER,
      protocol: CLAUDE_REPLAY_PROTOCOL,
      version,
      capturedAt: DateTime.formatIso(yield* DateTime.now).slice(0, 10),
      scenario: scenarioName,
      metadata: {
        sdkVersion,
        ...scenario.metadata,
        nativeSessionId: recording.sessionIds[0],
        recorder: "apps/server/scripts/record-claude-replay.ts",
      },
    },
    entries,
  });

  const out = yield* writeRecording({
    scenario: scenarioName,
    provider: "claude",
    text,
    machine,
    workspace,
  });
  yield* Effect.logInfo("Wrote the recording.").pipe(
    Effect.annotateLogs({ out, entries: entries.length }),
  );
});

program.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);

// @effect-diagnostics preferSchemaOverJson:off -- Recorded frames are plain JSON values.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  encodeProviderReplayNdjson,
  type ProviderReplayEntry,
} from "@playstead/provider-testing/replayTranscript";
import { withoutAgentShellVariables } from "@playstead/shared/agentShell";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  CODEX_REPLAY_PROTOCOL,
  CODEX_REPLAY_PROVIDER,
  makeRecordingClientFactory,
} from "../src/orchestration-v2/Adapters/CodexAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "../src/orchestration-v2/testkit/OrchestratorHarness.ts";
import {
  CODEX_FILE_CREATE_SCENARIO,
  runProviderFileCreateScenario,
} from "../src/orchestration-v2/testkit/fixtures/fileCreate.ts";
import {
  CODEX_RESTART_RESUME_SCENARIO,
  RESTART_RESUME_IDS,
  runFirstTurn,
  runSecondTurn,
} from "../src/orchestration-v2/testkit/fixtures/restartResume.ts";
import {
  QUESTION_ANSWER_SCENARIO_NAME,
  QUESTION_INTERRUPT_SCENARIO_NAME,
} from "../src/orchestration-v2/testkit/fixtures/questionAnswer.ts";
import {
  CODEX_TURN_INTERRUPT_SCENARIO,
  runTurnInterruptScenario,
} from "../src/orchestration-v2/testkit/fixtures/turnInterrupt.ts";
import {
  readMachineIdentity,
  recordingReplacements,
  scrubbed,
  writeRecording,
} from "../src/orchestration-v2/testkit/replayScrub.ts";
import { makeTestServerConfig } from "../src/testUtils/testServer.ts";

/**
 * Playstead's Codex app-server recorder (T3 Code's
 * `apps/server/scripts/record-codex-app-server-replay-fixture.ts` at 2577baf
 * hand-builds the adapter's frames; this one runs the Seam 1 scenario
 * through Playstead's own adapter and taps the client's stdio, so a
 * recording is exactly what the adapter sends). It uses the signed-in
 * `codex` on PATH, in a temporary empty folder, and writes
 * `src/orchestration-v2/testkit/fixtures/<scenario>.codex.ndjson`.
 *
 *   node apps/server/scripts/record-codex-replay.ts [file_create | restart_resume | turn_interrupt | --help]
 *
 * `restart_resume` builds the services a second time over the same home
 * between its two turns, as a restarted server would, so the recording
 * holds two app-servers. `turn_interrupt` interrupts a long command once it
 * runs, then sends one more message.
 *
 * `question_answer` and `question_interrupt` cannot be recorded, and the
 * recorder says so when asked for them: Codex 0.163.0 refuses
 * `request_user_input` outside plan mode, and Playstead runs no plan mode, so
 * `question_answer.codex.ndjson` and `question_interrupt.codex.ndjson` are
 * hand-made (see their headers).
 *
 * The header carries `codex --version` and the capture date. The frames are
 * scrubbed by `src/orchestration-v2/testkit/replayScrub.ts`, shared with the
 * Claude recorder, which also refuses to write a file that still names this
 * machine or an account.
 */

const codexVersion = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const output = yield* spawner.string(ChildProcess.make("codex", ["--version"]));
  const version = /\b(\d+\.\d+\.\d+)\b/.exec(output)?.[1];
  if (version === undefined) return yield* Effect.die(`codex --version printed: ${output}`);
  return version;
});

/** The Codex thread the recording's first `thread/start` answered with. */
const startedThreadId = (entries: ReadonlyArray<ProviderReplayEntry>) =>
  entries
    .map((entry) =>
      entry.type === "emit_inbound"
        ? (entry.frame as { readonly result?: { readonly thread?: { readonly id?: unknown } } })
            .result?.thread?.id
        : undefined,
    )
    .find((id) => typeof id === "string");

type HarnessOptions = Parameters<typeof makeOrchestrationHarness>[0];

/** One file-creating turn. */
const recordFileCreate = (options: HarnessOptions) =>
  Effect.gen(function* () {
    const harness = yield* makeOrchestrationHarness(options);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const scenario = CODEX_FILE_CREATE_SCENARIO;
    const { workspace, run } = yield* runProviderFileCreateScenario(harness, scenario);
    const written = path.join(workspace, scenario.fileName);
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
      CODEX_TURN_INTERRUPT_SCENARIO,
    );
    yield* Effect.logInfo("The turns ended.").pipe(
      Effect.annotateLogs({ first: first.status, next: next.status }),
    );
    if (first.status !== "interrupted" || next.status !== "completed") {
      return yield* Effect.die(`The runs ended ${first.status} and ${next.status}.`);
    }
    return { harness, workspace };
  });

/** A turn, a restart over the same home, and a turn that needs the first one's context. */
const recordRestartResume = (options: HarnessOptions) =>
  Effect.gen(function* () {
    const scenario = CODEX_RESTART_RESUME_SCENARIO;
    const config = yield* makeTestServerConfig();
    const first = yield* Effect.scoped(
      Effect.flatMap(makeOrchestrationHarness({ ...options, config }), (harness) =>
        runFirstTurn(harness, scenario),
      ),
    );
    if (first.run.status !== "completed") {
      return yield* Effect.die(`The first run ended ${first.run.status}.`);
    }
    const harness = yield* makeOrchestrationHarness({ ...options, config, recoverOnStartup: true });
    const second = yield* runSecondTurn(harness, scenario);
    const projection = yield* harness.orchestrator.getThreadProjection(RESTART_RESUME_IDS.threadId);
    const reply =
      projection._tag === "Some"
        ? projection.value.messages.findLast((message) => message.role === "assistant")?.text
        : undefined;
    yield* Effect.logInfo("The turn after the restart ended.").pipe(
      Effect.annotateLogs({ run: second.status, reply: JSON.stringify(reply) }),
    );
    if (second.status !== "completed" || !reply?.toLowerCase().includes(scenario.codeWord)) {
      return yield* Effect.die("Codex did not remember the code word after the restart.");
    }
    return { harness, workspace: first.workspace };
  });

/** Each scenario: how it is recorded, and what the header says about it. */
const SCENARIOS = {
  [CODEX_FILE_CREATE_SCENARIO.scenario]: {
    record: recordFileCreate,
    metadata: {
      model: CODEX_FILE_CREATE_SCENARIO.model,
      prompt: CODEX_FILE_CREATE_SCENARIO.prompt,
    },
  },
  [CODEX_RESTART_RESUME_SCENARIO.scenario]: {
    record: recordRestartResume,
    metadata: {
      model: CODEX_RESTART_RESUME_SCENARIO.model,
      prompts: [
        CODEX_RESTART_RESUME_SCENARIO.firstPrompt,
        CODEX_RESTART_RESUME_SCENARIO.secondPrompt,
      ],
    },
  },
  [CODEX_TURN_INTERRUPT_SCENARIO.scenario]: {
    record: recordTurnInterrupt,
    metadata: {
      model: CODEX_TURN_INTERRUPT_SCENARIO.model,
      prompts: [CODEX_TURN_INTERRUPT_SCENARIO.longPrompt, CODEX_TURN_INTERRUPT_SCENARIO.nextPrompt],
      interruptAfter: "command_execution running",
    },
  },
};

/** Scenarios with a Codex fixture that this recorder cannot make. */
const HAND_MADE_SCENARIOS: ReadonlyArray<string> = [
  QUESTION_ANSWER_SCENARIO_NAME,
  QUESTION_INTERRUPT_SCENARIO_NAME,
];

const HAND_MADE_REASON =
  `${HAND_MADE_SCENARIOS.join(" and ")} are hand-made Codex fixtures, not recordings: ` +
  "Codex 0.163.0 refuses request_user_input outside plan mode, and Playstead runs no plan mode, " +
  "so a real Codex never asks. Edit question_answer.codex.ndjson and " +
  "question_interrupt.codex.ndjson by hand; their headers say how they were made.";

const HELP = [
  "Records a Codex app-server replay through Playstead's adapter.",
  "",
  `  node apps/server/scripts/record-codex-replay.ts [${Object.keys(SCENARIOS).join(" | ")}]`,
  "",
  `The default is ${CODEX_FILE_CREATE_SCENARIO.scenario}. ${HAND_MADE_REASON}`,
].join("\n");

const program = Effect.gen(function* () {
  const scenarioName = process.argv[2] ?? CODEX_FILE_CREATE_SCENARIO.scenario;
  if (scenarioName === "--help" || scenarioName === "-h") return yield* Console.log(HELP);
  if (HAND_MADE_SCENARIOS.includes(scenarioName)) {
    return yield* Effect.die(`Cannot record ${scenarioName}. ${HAND_MADE_REASON}`);
  }
  const scenario = Object.hasOwn(SCENARIOS, scenarioName)
    ? SCENARIOS[scenarioName as keyof typeof SCENARIOS]
    : undefined;
  if (scenario === undefined) {
    return yield* Effect.die(
      `No scenario is called ${scenarioName}. The scenarios are ${Object.keys(SCENARIOS).join(", ")}; ${HAND_MADE_REASON}`,
    );
  }
  const version = yield* codexVersion;

  const recording = yield* makeRecordingClientFactory();
  const { harness, workspace } = yield* scenario.record({
    codexClients: recording.clients,
    codexBinaryPath: "codex",
    environment: withoutAgentShellVariables(process.env),
  });

  const machine = readMachineIdentity();
  const replacements = recordingReplacements({ workspace, playsteadHome: harness.home, machine });
  const entries: Array<ProviderReplayEntry> = recording.entries.map((entry) => ({
    ...entry,
    frame: scrubbed(entry.frame, replacements),
  }));
  const text = encodeProviderReplayNdjson({
    header: {
      type: "transcript_start",
      provider: CODEX_REPLAY_PROVIDER,
      protocol: CODEX_REPLAY_PROTOCOL,
      version,
      capturedAt: DateTime.formatIso(yield* DateTime.now).slice(0, 10),
      scenario: scenarioName,
      metadata: {
        ...scenario.metadata,
        nativeThreadId: startedThreadId(entries),
        recorder: "apps/server/scripts/record-codex-replay.ts",
      },
    },
    entries,
  });

  const out = yield* writeRecording({
    scenario: scenarioName,
    provider: "codex",
    text,
    machine,
    workspace,
  });
  yield* Effect.logInfo("Wrote the recording.").pipe(
    Effect.annotateLogs({ out, entries: entries.length }),
  );
});

program.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);

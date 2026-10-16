// @effect-diagnostics nodeBuiltinImport:off -- The recorder reads this machine's identity to scrub it.
// @effect-diagnostics preferSchemaOverJson:off -- Recorded frames are plain JSON values.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  encodeProviderReplayNdjson,
  type ProviderReplayEntry,
  REPLAY_WORKSPACE_PLACEHOLDER,
} from "@playstead/provider-testing/replayTranscript";
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
  FILE_CREATE_SCENARIO,
  runFileCreateScenario,
} from "../src/orchestration-v2/testkit/fixtures/fileCreate.ts";
import {
  RESTART_RESUME_IDS,
  RESTART_RESUME_SCENARIO,
  runFirstTurn,
  runSecondTurn,
} from "../src/orchestration-v2/testkit/fixtures/restartResume.ts";
import { makeTestServerConfig } from "../src/testUtils/testServer.ts";

/**
 * Playstead's Claude Agent SDK recorder (T3 Code's
 * `apps/server/scripts/record-claude-agent-sdk-replay-fixture.ts` at 2577baf
 * records by hand-driving `query()`; this one runs the Seam 1 scenario
 * through Playstead's own adapter, so a recording is exactly what the
 * adapter sends). It uses the signed-in `claude` on PATH, in a temporary
 * empty folder, and writes `src/orchestration-v2/testkit/fixtures/<scenario>.claude.ndjson`.
 *
 *   node apps/server/scripts/record-claude-replay.ts [file_create | restart_resume]
 *
 * `restart_resume` builds the services a second time over the same home
 * between its two turns, as a restarted server would.
 *
 * The header carries `claude --version` and the capture date. The frames are
 * scrubbed of the folder (which becomes `<workspace>`), this machine's home,
 * user and host names, account e-mails and anything shaped like a token, and
 * the recorder refuses to write a file that still contains any of them.
 */

/** Variables a coding agent's shell carries that must not reach the recorded Claude. */
const isAgentShellVariable = (name: string) =>
  name === "ELECTRON_RUN_AS_NODE" ||
  name === "CLAUDECODE" ||
  name.startsWith("CLAUDE_CODE_") ||
  name.startsWith("T3CODE_");

const claudeVersion = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const output = yield* spawner.string(ChildProcess.make("claude", ["--version"]));
  const version = /\b(\d+\.\d+\.\d+)\b/.exec(output)?.[1];
  if (version === undefined) return yield* Effect.die(`claude --version printed: ${output}`);
  return version;
});

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN =
  /\b(?:sk-ant-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g;
const SECRET_KEYS = /token|secret|password|api[_-]?key|authorization|cookie|email/i;

type Replacements = ReadonlyArray<readonly [string, string]>;

const scrubbedText = (value: string, replacements: Replacements) => {
  let text = value;
  for (const [from, to] of replacements) text = text.split(from).join(to);
  return text.replace(EMAIL, "user@example.com").replace(TOKEN, "REDACTED");
};

const scrubbed = (value: unknown, replacements: Replacements): unknown => {
  if (typeof value === "string") return scrubbedText(value, replacements);
  if (Array.isArray(value)) return value.map((item) => scrubbed(item, replacements));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_KEYS.test(key) && typeof item === "string"
          ? "REDACTED"
          : scrubbed(item, replacements),
      ]),
    );
  }
  return value;
};

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

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scenario = process.argv[2] ?? FILE_CREATE_SCENARIO.scenario;
  if (scenario !== FILE_CREATE_SCENARIO.scenario && scenario !== RESTART_RESUME_SCENARIO.scenario) {
    return yield* Effect.die(`No scenario is called ${scenario}.`);
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
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !isAgentShellVariable(name)),
  );
  const harnessOptions = {
    claudeRunner: recording.runner,
    claudeBinaryPath: "claude",
    environment,
  } as const;
  const { harness, workspace } =
    scenario === RESTART_RESUME_SCENARIO.scenario
      ? yield* recordRestartResume(harnessOptions)
      : yield* recordFileCreate(harnessOptions);

  const home = NodeOS.homedir();
  const user = NodeOS.userInfo().username;
  const host = NodeOS.hostname();
  const realWorkspace = NodeFS.realpathSync(workspace);
  const realHome = NodeFS.realpathSync(harness.home);
  // Longest first, so the folder goes before the home that contains it.
  const replacements: ReadonlyArray<readonly [string, string]> = [
    [realWorkspace, REPLAY_WORKSPACE_PLACEHOLDER],
    [workspace, REPLAY_WORKSPACE_PLACEHOLDER],
    [realHome, "/tmp/playstead-replay-home"],
    [harness.home, "/tmp/playstead-replay-home"],
    [home, "/home/replay-user"],
    [host, "replay-host"],
    [`/${user}/`, "/replay-user/"],
  ];
  const entries: Array<ProviderReplayEntry> = collapseScrubbedDeltas(
    recording.entries,
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
      scenario,
      metadata: {
        sdkVersion,
        ...(scenario === RESTART_RESUME_SCENARIO.scenario
          ? {
              model: RESTART_RESUME_SCENARIO.model,
              prompts: [RESTART_RESUME_SCENARIO.firstPrompt, RESTART_RESUME_SCENARIO.secondPrompt],
            }
          : { model: FILE_CREATE_SCENARIO.model, prompt: FILE_CREATE_SCENARIO.prompt }),
        nativeSessionId: recording.sessionIds[0],
        recorder: "apps/server/scripts/record-claude-replay.ts",
      },
    },
    entries,
  });

  const leaks = [
    home,
    `/${user}/`,
    host,
    realWorkspace,
    workspace,
    NodeOS.tmpdir(),
    "/var/folders",
    "/private/",
  ].filter((value) => value.length >= 3 && text.includes(value));
  if (leaks.length > 0 || EMAIL.test(text.replace(/user@example\.com/g, ""))) {
    return yield* Effect.die("The scrubbed recording still names this machine or an account.");
  }
  const out = path.join(
    path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
    "..",
    "src",
    "orchestration-v2",
    "testkit",
    "fixtures",
    `${scenario}.claude.ndjson`,
  );
  yield* fs.writeFileString(out, text);
  yield* Effect.logInfo("Wrote the recording.").pipe(
    Effect.annotateLogs({ out, entries: entries.length }),
  );
});

program.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);

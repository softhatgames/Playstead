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
  CODEX_TURN_INTERRUPT_SCENARIO,
  runTurnInterruptScenario,
} from "../src/orchestration-v2/testkit/fixtures/turnInterrupt.ts";

/**
 * Playstead's Codex app-server recorder (T3 Code's
 * `apps/server/scripts/record-codex-app-server-replay-fixture.ts` at 2577baf
 * hand-builds the adapter's frames; this one runs the Seam 1 scenario
 * through Playstead's own adapter and taps the client's stdio, so a
 * recording is exactly what the adapter sends). It uses the signed-in
 * `codex` on PATH, in a temporary empty folder, and writes
 * `src/orchestration-v2/testkit/fixtures/<scenario>.codex.ndjson`.
 *
 *   node apps/server/scripts/record-codex-replay.ts [file_create | turn_interrupt]
 *
 * `turn_interrupt` interrupts a long command once it runs, then sends one
 * more message.
 *
 * There is no question scenario: Codex 0.163.0 refuses `request_user_input`
 * outside plan mode, so `question_answer.codex.ndjson` and
 * `question_interrupt.codex.ndjson` are hand-made (see their headers).
 *
 * The header carries `codex --version` and the capture date. The frames are
 * scrubbed of the folder (which becomes `<workspace>`), this machine's home,
 * user and host names, Codex's installation and account ids, account
 * e-mails and anything shaped like a token, and the recorder refuses to
 * write a file that still contains any of them.
 */

/** Variables a coding agent's shell carries that must not reach the recorded Codex. */
const isAgentShellVariable = (name: string) =>
  name === "ELECTRON_RUN_AS_NODE" ||
  name === "CLAUDECODE" ||
  name.startsWith("CLAUDE_CODE_") ||
  name.startsWith("T3CODE_");

const codexVersion = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const output = yield* spawner.string(ChildProcess.make("codex", ["--version"]));
  const version = /\b(\d+\.\d+\.\d+)\b/.exec(output)?.[1];
  if (version === undefined) return yield* Effect.die(`codex --version printed: ${output}`);
  return version;
});

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN = /\b(?:sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g;
const SECRET_KEYS = /token|secret|password|api[_-]?key|authorization|cookie|email/i;
/** Ids Codex sends at start-up that name this installation or account. */
const IDENTITY_KEYS = /^(installationId|chatgptAccountId|accountId|userId|workspaceId)$/;
const ZERO_UUID = "00000000-0000-4000-8000-000000000000";

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
        typeof item === "string" && IDENTITY_KEYS.test(key)
          ? ZERO_UUID
          : typeof item === "string" && key === "planType"
            ? "unknown"
            : typeof item === "string" && SECRET_KEYS.test(key)
              ? "REDACTED"
              : scrubbed(item, replacements),
      ]),
    );
  }
  return value;
};

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scenarioName = process.argv[2] ?? CODEX_FILE_CREATE_SCENARIO.scenario;
  if (
    scenarioName !== CODEX_FILE_CREATE_SCENARIO.scenario &&
    scenarioName !== CODEX_TURN_INTERRUPT_SCENARIO.scenario
  ) {
    return yield* Effect.die(`No scenario is called ${scenarioName}.`);
  }
  const version = yield* codexVersion;

  const recording = yield* makeRecordingClientFactory();
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !isAgentShellVariable(name)),
  );
  const harness = yield* makeOrchestrationHarness({
    codexClients: recording.clients,
    codexBinaryPath: "codex",
    environment,
  });
  const home = harness.home;
  const workspace =
    scenarioName === CODEX_TURN_INTERRUPT_SCENARIO.scenario
      ? yield* Effect.gen(function* () {
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
          return workspace;
        })
      : yield* Effect.gen(function* () {
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
          if (run.status !== "completed") {
            return yield* Effect.die(`The run ended ${run.status}.`);
          }
          return workspace;
        });

  const machineHome = NodeOS.homedir();
  const user = NodeOS.userInfo().username;
  const host = NodeOS.hostname();
  const shortHost = host.split(".")[0] ?? host;
  const realWorkspace = NodeFS.realpathSync(workspace);
  const realHome = NodeFS.realpathSync(home);
  // Longest first, so the folder goes before the home that contains it.
  const replacements: Replacements = [
    [realWorkspace, REPLAY_WORKSPACE_PLACEHOLDER],
    [workspace, REPLAY_WORKSPACE_PLACEHOLDER],
    [realHome, "/tmp/playstead-replay-home"],
    [home, "/tmp/playstead-replay-home"],
    [machineHome, "/home/replay-user"],
    [host, "replay-host"],
    [shortHost, "replay-host"],
    [`/${user}/`, "/replay-user/"],
  ];
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
        ...(scenarioName === CODEX_TURN_INTERRUPT_SCENARIO.scenario
          ? {
              model: CODEX_TURN_INTERRUPT_SCENARIO.model,
              prompts: [
                CODEX_TURN_INTERRUPT_SCENARIO.longPrompt,
                CODEX_TURN_INTERRUPT_SCENARIO.nextPrompt,
              ],
              interruptAfter: "command_execution running",
            }
          : { model: CODEX_FILE_CREATE_SCENARIO.model, prompt: CODEX_FILE_CREATE_SCENARIO.prompt }),
        recorder: "apps/server/scripts/record-codex-replay.ts",
      },
    },
    entries,
  });

  const leaks = [
    machineHome,
    `/${user}/`,
    host,
    shortHost,
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
    `${scenarioName}.codex.ndjson`,
  );
  yield* fs.writeFileString(out, text);
  yield* Effect.logInfo("Wrote the recording.").pipe(
    Effect.annotateLogs({ out, entries: entries.length }),
  );
});

program.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);

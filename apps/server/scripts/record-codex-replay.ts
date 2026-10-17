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
  CODEX_AUTO_MODE_SCENARIO,
  runAutoModeScenario,
} from "../src/orchestration-v2/testkit/fixtures/autoMode.ts";
import {
  CODEX_FILE_CREATE_SCENARIO,
  runProviderFileCreateScenario,
} from "../src/orchestration-v2/testkit/fixtures/fileCreate.ts";
import {
  QUESTION_ANSWER_SCENARIO_NAME,
  QUESTION_INTERRUPT_SCENARIO_NAME,
} from "../src/orchestration-v2/testkit/fixtures/questionAnswer.ts";
import {
  describeSessionApprovalRun,
  runSessionApprovalScenario,
  SESSION_APPROVAL_SCENARIOS,
  type SessionApprovalScenario,
} from "../src/orchestration-v2/testkit/fixtures/sessionApprovals.ts";
import {
  CODEX_SUPERVISED_SCENARIO,
  runSupervisedScenario,
  SUPERVISED_ANSWERS,
  type SupervisedScenarioName,
} from "../src/orchestration-v2/testkit/fixtures/supervisedApproval.ts";
import {
  CODEX_TURN_INTERRUPT_SCENARIO,
  runTurnInterruptScenario,
} from "../src/orchestration-v2/testkit/fixtures/turnInterrupt.ts";
import {
  CODEX_TRAITS_CHANGE_SCENARIO,
  runTraitsChangeScenario,
} from "../src/orchestration-v2/testkit/fixtures/traitsChange.ts";
import {
  readMachineIdentity,
  recordingReplacements,
  scrubbed,
  writeRecording,
} from "../src/orchestration-v2/testkit/replayScrub.ts";

/**
 * Playstead's Codex app-server recorder (T3 Code's
 * `apps/server/scripts/record-codex-app-server-replay-fixture.ts` at 2577baf
 * hand-builds the adapter's frames; this one runs the Seam 1 scenario
 * through Playstead's own adapter and taps the client's stdio, so a
 * recording is exactly what the adapter sends). It uses the signed-in
 * `codex` on PATH, in a temporary empty folder, and writes
 * `src/orchestration-v2/testkit/fixtures/<scenario>.codex.ndjson`.
 *
 *   node apps/server/scripts/record-codex-replay.ts [file_create | turn_interrupt | auto_mode | traits_change | approval_accept | approval_decline | approval_cancel | approval_interrupt | auto_accept_edits | session_command | session_edits | --help]
 *
 * `turn_interrupt` interrupts a long command once it runs, then sends one
 * more message. `auto_mode` writes a file in Auto, then sends one more
 * message after the change to Full access. `traits_change` sends turns that
 * each carry another reasoning effort and service tier. The `approval_*` scenarios ask
 * Codex, in Supervised, to write a file, and approve, decline or cancel each
 * approval through `runtime-request.respond`, or interrupt the turn waiting
 * on one. `auto_accept_edits`, `session_command` and `session_edits` send
 * turns in Auto-accept edits and Supervised and answer each turn's
 * approvals with its decision, **Always allow this session** among them.
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

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

/** One file-creating turn. */
const recordFileCreate = (harness: Harness) =>
  Effect.gen(function* () {
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
    return workspace;
  });

/** A turn interrupted while its command runs, then a turn after it. */
const recordTurnInterrupt = (harness: Harness) =>
  Effect.gen(function* () {
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
  });

/** Turns that each carry other traits. */
const recordTraitsChange = (harness: Harness) =>
  Effect.gen(function* () {
    const { workspace, runs } = yield* runTraitsChangeScenario(
      harness,
      CODEX_TRAITS_CHANGE_SCENARIO,
    );
    yield* Effect.logInfo("The turns ended.").pipe(
      Effect.annotateLogs({ runs: runs.map((run) => run.status).join(", ") }),
    );
    if (runs.some((run) => run.status !== "completed")) {
      return yield* Effect.die("A traits turn did not complete.");
    }
    return workspace;
  });

/** A file written in Auto, then a turn after the change to Full access. */
const recordAutoMode = (harness: Harness) =>
  Effect.gen(function* () {
    const { workspace, write, next } = yield* runAutoModeScenario(
      harness,
      CODEX_AUTO_MODE_SCENARIO,
    );
    yield* Effect.logInfo("The turns ended.").pipe(
      Effect.annotateLogs({ write: write.status, next: next.status }),
    );
    if (write.status !== "completed" || next.status !== "completed") {
      return yield* Effect.die(`The runs ended ${write.status} and ${next.status}.`);
    }
    return workspace;
  });

/** A file write in Supervised, and the person's answer to each approval it asks for. */
const recordSupervised = (harness: Harness, name: SupervisedScenarioName) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const answer = SUPERVISED_ANSWERS[name];
    const { workspace, approvals, run } = yield* runSupervisedScenario(
      harness,
      CODEX_SUPERVISED_SCENARIO,
      answer,
    );
    const written = path.join(workspace, CODEX_SUPERVISED_SCENARIO.fileName);
    yield* Effect.logInfo("The turn ended.").pipe(
      Effect.annotateLogs({
        run: run.status,
        approvals: JSON.stringify(approvals.map((approval) => approval.kind)),
        file: (yield* fs.exists(written)) ? "written" : "missing",
      }),
    );
    const expected = answer === "accept" || answer === "decline" ? "completed" : "interrupted";
    if (run.status !== expected || approvals.length === 0) {
      return yield* Effect.die(`The run ended ${run.status} after ${approvals.length} approvals.`);
    }
    // Only an approved change may happen.
    if ((yield* fs.exists(written)) !== (answer === "accept")) {
      return yield* Effect.die(`The file is ${answer === "accept" ? "missing" : "written"}.`);
    }
    return workspace;
  });

/** Turns whose approvals are each answered with the turn's decision. */
const recordSessionApprovals = (harness: Harness, scenario: SessionApprovalScenario) =>
  Effect.gen(function* () {
    const { workspace, turns } = yield* runSessionApprovalScenario(harness, scenario);
    yield* Effect.logInfo("The turns ended.").pipe(
      Effect.annotateLogs(yield* describeSessionApprovalRun(workspace, scenario, turns)),
    );
    if (turns.some((turn) => turn.run.status !== "completed")) {
      return yield* Effect.die("A turn did not complete.");
    }
    return workspace;
  });

const sessionApprovalEntry = (scenario: SessionApprovalScenario) => ({
  record: (harness: Harness) => recordSessionApprovals(harness, scenario),
  metadata: { model: scenario.model, turns: scenario.turns },
});

const supervisedEntry = (name: SupervisedScenarioName) => ({
  record: (harness: Harness) => recordSupervised(harness, name),
  metadata: {
    model: CODEX_SUPERVISED_SCENARIO.model,
    prompt: CODEX_SUPERVISED_SCENARIO.prompt,
    runtimeMode: "approval-required",
    answer: SUPERVISED_ANSWERS[name],
  },
});

/** Each scenario: how it is recorded, and what the header says about it. */
const SCENARIOS = {
  approval_accept: supervisedEntry("approval_accept"),
  approval_decline: supervisedEntry("approval_decline"),
  approval_cancel: supervisedEntry("approval_cancel"),
  approval_interrupt: supervisedEntry("approval_interrupt"),
  auto_accept_edits: sessionApprovalEntry(SESSION_APPROVAL_SCENARIOS.codex.auto_accept_edits),
  session_command: sessionApprovalEntry(SESSION_APPROVAL_SCENARIOS.codex.session_command),
  session_edits: sessionApprovalEntry(SESSION_APPROVAL_SCENARIOS.codex.session_edits),
  [CODEX_TRAITS_CHANGE_SCENARIO.scenario]: {
    record: recordTraitsChange,
    metadata: {
      model: CODEX_TRAITS_CHANGE_SCENARIO.model,
      turns: CODEX_TRAITS_CHANGE_SCENARIO.turns,
    },
  },
  [CODEX_AUTO_MODE_SCENARIO.scenario]: {
    record: recordAutoMode,
    metadata: {
      model: CODEX_AUTO_MODE_SCENARIO.model,
      prompts: [CODEX_AUTO_MODE_SCENARIO.writePrompt, CODEX_AUTO_MODE_SCENARIO.nextPrompt],
      runtimeModes: ["auto", "full-access"],
    },
  },
  [CODEX_FILE_CREATE_SCENARIO.scenario]: {
    record: recordFileCreate,
    metadata: {
      model: CODEX_FILE_CREATE_SCENARIO.model,
      prompt: CODEX_FILE_CREATE_SCENARIO.prompt,
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
  const harness = yield* makeOrchestrationHarness({
    codexClients: recording.clients,
    codexBinaryPath: "codex",
    environment: withoutAgentShellVariables(process.env),
  });
  const workspace = yield* scenario.record(harness);

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
      metadata: { ...scenario.metadata, recorder: "apps/server/scripts/record-codex-replay.ts" },
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

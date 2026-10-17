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
  CODEX_PROPOSED_PLAN_SCENARIO,
  PROPOSED_PLAN_SCENARIO_NAME,
  runProposedPlanScenario,
} from "../src/orchestration-v2/testkit/fixtures/proposedPlan.ts";
import {
  CODEX_RESTART_RESUME_MODES_SCENARIO,
  CODEX_RESTART_RESUME_SCENARIO,
  RESTART_RESUME_IDS,
  type RestartResumeScenario,
  runFirstTurn,
  runSecondTurn,
} from "../src/orchestration-v2/testkit/fixtures/restartResume.ts";
import {
  CODEX_QUESTION_SCENARIO,
  QUESTION_ANSWER_SCENARIO_NAME,
  QUESTION_INTERRUPT_SCENARIO_NAME,
  runQuestionAnswerScenario,
  runQuestionInterruptScenario,
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
  CODEX_TODO_LIST_SCENARIO,
  runTodoListScenario,
  TODO_LIST_IDS,
  TODO_LIST_SCENARIO_NAME,
} from "../src/orchestration-v2/testkit/fixtures/todoList.ts";
import {
  CODEX_TRAITS_CHANGE_SCENARIO,
  runTraitsChangeScenario,
} from "../src/orchestration-v2/testkit/fixtures/traitsChange.ts";
import {
  CODEX_QUEUED_TURN_SCENARIO,
  queuedTurnPrompt,
  runQueuedTurnScenario,
} from "../src/orchestration-v2/testkit/fixtures/queuedTurn.ts";
import {
  CODEX_MESSAGE_STEERING_SCENARIO,
  runMessageSteeringScenario,
} from "../src/orchestration-v2/testkit/fixtures/messageSteering.ts";
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
 *   node apps/server/scripts/record-codex-replay.ts [file_create | restart_resume | restart_resume_modes | turn_interrupt | auto_mode | traits_change | proposed_plan | question_answer | question_interrupt | todo_list | approval_accept | approval_decline | approval_cancel | approval_interrupt | auto_accept_edits | session_command | session_edits | queued_turn | message_steering | --help]
 *
 * `restart_resume` builds the services a second time over the same home
 * between its two turns, as a restarted server would, so the recording
 * holds two app-servers; `restart_resume_modes` plans in Auto before the
 * restart and asks in Supervised and the default mode after it.
 * `turn_interrupt` interrupts a long command once it
 * runs, then sends one more message. `auto_mode` writes a file in Auto, then sends one more
 * message after the change to Full access. `traits_change` sends turns that
 * each carry another reasoning effort and service tier. The `approval_*` scenarios ask
 * Codex, in Supervised, to write a file, and approve, decline or cancel each
 * approval through `runtime-request.respond`, or interrupt the turn waiting
 * on one. `auto_accept_edits`, `session_command` and `session_edits` send
 * turns in Auto-accept edits and Supervised and answer each turn's
 * approvals with its decision, **Always allow this session** among them.
 * `queued_turn` queues messages behind a turn, removes one, and holds the
 * queue with Stop before resuming it. `message_steering` steers a turn
 * while its command runs, then sends a steer as a turn ends, which starts
 * a turn of its own.
 *
 * `proposed_plan` asks for a plan in plan mode, then implements it in the
 * default mode. `question_answer` and `question_interrupt` run in plan mode,
 * the only mode in which Codex 0.163.0 uses `request_user_input` (T3 Code's
 * `plan_questions`), and answer the question or interrupt the turn. `todo_list`
 * keeps a todo list with Codex's plan tool.
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

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;
type HarnessOptions = Parameters<typeof makeOrchestrationHarness>[0];

/** A recorder that needs one harness, made from the recording's options. */
const withHarness =
  <E, R>(record: (harness: Harness) => Effect.Effect<string, E, R>) =>
  (options: HarnessOptions) =>
    Effect.flatMap(makeOrchestrationHarness(options), (harness) =>
      Effect.map(record(harness), (workspace) => ({ harness, workspace })),
    );

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
const recordRestartResume = (scenario: RestartResumeScenario) => (options: HarnessOptions) =>
  Effect.gen(function* () {
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

/** Queued turns, one removed, and a queue held by Stop and resumed. */
const recordQueuedTurn = (harness: Harness) =>
  Effect.gen(function* () {
    const { workspace, one, two, five } = yield* runQueuedTurnScenario(
      harness,
      CODEX_QUEUED_TURN_SCENARIO,
    );
    yield* Effect.logInfo("The turns ended.").pipe(
      Effect.annotateLogs({ runs: [one, two, five].map((run) => run.status).join(", ") }),
    );
    if ([one, two, five].some((run) => run.status !== "completed")) {
      return yield* Effect.die("A queued turn did not complete.");
    }
    return workspace;
  });

/** A turn steered while its command runs, then a steer too late that starts its own turn. */
const recordMessageSteering = (harness: Harness) =>
  Effect.gen(function* () {
    const { workspace, steered, three, late } = yield* runMessageSteeringScenario(
      harness,
      CODEX_MESSAGE_STEERING_SCENARIO,
    );
    const runs = [steered, three, late];
    yield* Effect.logInfo("The turns ended.").pipe(
      Effect.annotateLogs({ runs: runs.map((run) => run.status).join(", ") }),
    );
    if (runs.some((run) => run.status !== "completed")) {
      return yield* Effect.die("A steering turn did not complete.");
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
  record: withHarness((harness: Harness) => recordSessionApprovals(harness, scenario)),
  metadata: { model: scenario.model, turns: scenario.turns },
});

const supervisedEntry = (name: SupervisedScenarioName) => ({
  record: withHarness((harness: Harness) => recordSupervised(harness, name)),
  metadata: {
    model: CODEX_SUPERVISED_SCENARIO.model,
    prompt: CODEX_SUPERVISED_SCENARIO.prompt,
    runtimeMode: "approval-required",
    answer: SUPERVISED_ANSWERS[name],
  },
});

/** In plan mode Codex asks, and the question is answered, or its turn interrupted. */
const recordQuestion = (harness: Harness, interrupt: boolean) =>
  Effect.gen(function* () {
    const { workspace, pending, run } = yield* (
      interrupt ? runQuestionInterruptScenario : runQuestionAnswerScenario
    )(harness, CODEX_QUESTION_SCENARIO);
    yield* Effect.logInfo("The turn ended.").pipe(
      Effect.annotateLogs({ run: run.status, questions: JSON.stringify(pending.item.questions) }),
    );
    if (run.status !== (interrupt ? "interrupted" : "completed")) {
      return yield* Effect.die(`The run ended ${run.status}.`);
    }
    return workspace;
  });

/** A plan proposed in plan mode, then implemented in the default mode. */
const recordProposedPlan = (harness: Harness) =>
  Effect.gen(function* () {
    const { workspace, planned, plan, fileAfterPlan, implemented } = yield* runProposedPlanScenario(
      harness,
      CODEX_PROPOSED_PLAN_SCENARIO,
    );
    yield* Effect.logInfo("The turns ended.").pipe(
      Effect.annotateLogs({
        planned: planned.status,
        plan: JSON.stringify(plan.markdown),
        implemented: implemented.status,
      }),
    );
    if (planned.status !== "completed" || implemented.status !== "completed" || fileAfterPlan) {
      return yield* Effect.die(
        `The runs ended ${planned.status} and ${implemented.status}; file written while planning: ${fileAfterPlan}.`,
      );
    }
    return workspace;
  });

/** A turn that keeps a todo list. */
const recordTodoList = (harness: Harness) =>
  Effect.gen(function* () {
    const { workspace, run } = yield* runTodoListScenario(harness, CODEX_TODO_LIST_SCENARIO);
    const projection = yield* harness.orchestrator.getThreadProjection(TODO_LIST_IDS.threadId);
    const lists = projection._tag === "Some" ? projection.value.plans : [];
    yield* Effect.logInfo("The turn ended.").pipe(
      Effect.annotateLogs({ run: run.status, plans: JSON.stringify(lists) }),
    );
    if (run.status !== "completed" || lists.length === 0) {
      return yield* Effect.die(`The run ended ${run.status} with ${lists.length} todo lists.`);
    }
    return workspace;
  });

const restartResumeEntry = (scenario: RestartResumeScenario) => ({
  record: recordRestartResume(scenario),
  metadata: {
    model: scenario.model,
    prompts: [scenario.firstPrompt, scenario.secondPrompt],
    ...(scenario.modes === undefined ? {} : { modes: scenario.modes }),
    ...(scenario.modesAfterRestart === undefined
      ? {}
      : { modesAfterRestart: scenario.modesAfterRestart }),
  },
});

/** Each scenario: how it is recorded, and what the header says about it. */
const SCENARIOS = {
  [TODO_LIST_SCENARIO_NAME]: {
    record: withHarness(recordTodoList),
    metadata: { model: CODEX_TODO_LIST_SCENARIO.model, prompt: CODEX_TODO_LIST_SCENARIO.prompt },
  },
  [PROPOSED_PLAN_SCENARIO_NAME]: {
    record: withHarness(recordProposedPlan),
    metadata: {
      model: CODEX_PROPOSED_PLAN_SCENARIO.model,
      prompt: CODEX_PROPOSED_PLAN_SCENARIO.planPrompt,
      interactionModes: ["plan", "default"],
    },
  },
  [QUESTION_ANSWER_SCENARIO_NAME]: {
    record: withHarness((harness: Harness) => recordQuestion(harness, false)),
    metadata: {
      model: CODEX_QUESTION_SCENARIO.model,
      prompt: CODEX_QUESTION_SCENARIO.prompt,
      answer: CODEX_QUESTION_SCENARIO.answer,
      interactionMode: CODEX_QUESTION_SCENARIO.interactionMode,
    },
  },
  [QUESTION_INTERRUPT_SCENARIO_NAME]: {
    record: withHarness((harness: Harness) => recordQuestion(harness, true)),
    metadata: {
      model: CODEX_QUESTION_SCENARIO.model,
      prompt: CODEX_QUESTION_SCENARIO.prompt,
      interactionMode: CODEX_QUESTION_SCENARIO.interactionMode,
      interruptAfter: "user_input pending",
    },
  },
  approval_accept: supervisedEntry("approval_accept"),
  approval_decline: supervisedEntry("approval_decline"),
  approval_cancel: supervisedEntry("approval_cancel"),
  approval_interrupt: supervisedEntry("approval_interrupt"),
  auto_accept_edits: sessionApprovalEntry(SESSION_APPROVAL_SCENARIOS.codex.auto_accept_edits),
  session_command: sessionApprovalEntry(SESSION_APPROVAL_SCENARIOS.codex.session_command),
  session_edits: sessionApprovalEntry(SESSION_APPROVAL_SCENARIOS.codex.session_edits),
  [CODEX_QUEUED_TURN_SCENARIO.scenario]: {
    record: withHarness(recordQueuedTurn),
    metadata: {
      model: CODEX_QUEUED_TURN_SCENARIO.model,
      prompts: [1, 2, 5].map(queuedTurnPrompt),
      queuedOptions: CODEX_QUEUED_TURN_SCENARIO.queuedOptions,
    },
  },
  [CODEX_MESSAGE_STEERING_SCENARIO.scenario]: {
    record: withHarness(recordMessageSteering),
    metadata: {
      model: CODEX_MESSAGE_STEERING_SCENARIO.model,
      prompts: CODEX_MESSAGE_STEERING_SCENARIO.prompts,
      steerAfter: "command_execution running",
      lateSteer: "sent while the turn's end is held back from the server",
    },
  },
  [CODEX_TRAITS_CHANGE_SCENARIO.scenario]: {
    record: withHarness(recordTraitsChange),
    metadata: {
      model: CODEX_TRAITS_CHANGE_SCENARIO.model,
      turns: CODEX_TRAITS_CHANGE_SCENARIO.turns,
    },
  },
  [CODEX_AUTO_MODE_SCENARIO.scenario]: {
    record: withHarness(recordAutoMode),
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
  [CODEX_RESTART_RESUME_SCENARIO.scenario]: restartResumeEntry(CODEX_RESTART_RESUME_SCENARIO),
  [CODEX_RESTART_RESUME_MODES_SCENARIO.scenario]: restartResumeEntry(
    CODEX_RESTART_RESUME_MODES_SCENARIO,
  ),
  [CODEX_TURN_INTERRUPT_SCENARIO.scenario]: {
    record: recordTurnInterrupt,
    metadata: {
      model: CODEX_TURN_INTERRUPT_SCENARIO.model,
      prompts: [CODEX_TURN_INTERRUPT_SCENARIO.longPrompt, CODEX_TURN_INTERRUPT_SCENARIO.nextPrompt],
      interruptAfter: "command_execution running",
    },
  },
};

const HELP = [
  "Records a Codex app-server replay through Playstead's adapter.",
  "",
  `  node apps/server/scripts/record-codex-replay.ts [${Object.keys(SCENARIOS).join(" | ")}]`,
  "",
  `The default is ${CODEX_FILE_CREATE_SCENARIO.scenario}.`,
].join("\n");

const program = Effect.gen(function* () {
  const scenarioName = process.argv[2] ?? CODEX_FILE_CREATE_SCENARIO.scenario;
  if (scenarioName === "--help" || scenarioName === "-h") return yield* Console.log(HELP);
  const scenario = Object.hasOwn(SCENARIOS, scenarioName)
    ? SCENARIOS[scenarioName as keyof typeof SCENARIOS]
    : undefined;
  if (scenario === undefined) {
    return yield* Effect.die(
      `No scenario is called ${scenarioName}. The scenarios are ${Object.keys(SCENARIOS).join(", ")}.`,
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

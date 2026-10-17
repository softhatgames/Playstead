import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { ProviderInteractionMode, RuntimeMode } from "@playstead/contracts/orchestrationV2";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import type { makeOrchestrationHarness } from "../OrchestratorHarness.ts";

/**
 * A conversation across a restart: the provider is told a code word, the
 * server restarts, and the provider is asked for the word. It can answer
 * only if the restarted server resumed the provider's own conversation.
 * Each provider's recorder runs it against the signed-in CLI; the restart
 * tests replay it. A scenario may start the thread in other modes and
 * change them after the restart, before the question.
 */
export interface ThreadModes {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

export interface RestartResumeScenario {
  readonly scenario: string;
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly codeWord: string;
  readonly firstPrompt: string;
  readonly secondPrompt: string;
  /** The thread's modes before the restart; Full access and build without. */
  readonly modes?: ThreadModes;
  /** The modes set after the restart, before the question. */
  readonly modesAfterRestart?: ThreadModes;
}

export const RESTART_RESUME_SCENARIO = {
  scenario: "restart_resume",
  instanceId: "claudeAgent",
  model: "claude-haiku-5-5",
  codeWord: "tangerine",
  firstPrompt: "Remember this code word for later: tangerine. Reply with just: OK.",
  secondPrompt: "What was the code word I gave you? Reply with just the word.",
} as const satisfies RestartResumeScenario;

/** Codex's conversation, with the model its other recordings use. */
export const CODEX_RESTART_RESUME_SCENARIO = {
  ...RESTART_RESUME_SCENARIO,
  instanceId: "codex",
  model: "gpt-5.6-terra",
} as const satisfies RestartResumeScenario;

/**
 * Codex planning in Auto before the restart, then asked in Supervised and
 * the default mode: the resumed Codex thread must leave plan mode and take
 * the new approval policy.
 */
export const CODEX_RESTART_RESUME_MODES_SCENARIO = {
  ...CODEX_RESTART_RESUME_SCENARIO,
  scenario: "restart_resume_modes",
  firstPrompt:
    "Remember this code word for later: tangerine. Do not plan anything; reply with just: OK.",
  modes: { runtimeMode: "auto", interactionMode: "plan" },
  modesAfterRestart: { runtimeMode: "approval-required", interactionMode: "default" },
} as const satisfies RestartResumeScenario;

export const RESTART_RESUME_IDS = {
  projectId: ProjectId.make("project:restart-resume"),
  threadId: ThreadId.make("thread:restart-resume"),
} as const;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

const sendAndAwait = (harness: Harness, turn: 1 | 2, text: string) =>
  Effect.gen(function* () {
    const sent = yield* harness.orchestrator.dispatch({
      type: "message.dispatch",
      dispatchMode: { type: "start_immediately" },
      commandId: CommandId.make(`command:restart-resume:message:${turn}`),
      threadId: RESTART_RESUME_IDS.threadId,
      messageId: MessageId.make(`message:restart-resume:${turn}`),
      text,
    });
    yield* harness.worker.drain;
    return yield* harness.awaitRunEnded(RESTART_RESUME_IDS.threadId, sent.sequence);
  });

/** Makes the `resumed-game` project and returns its id and folder. */
const makeResumedGameProject = (harness: Harness) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(harness.home, "resumed-game");
    yield* fs.makeDirectory(folder);
    yield* harness.projects.create({
      commandId: CommandId.make("command:restart-resume:project"),
      projectId: RESTART_RESUME_IDS.projectId,
      title: "resumed-game",
      workspaceRoot: folder,
    });
    return { projectId: RESTART_RESUME_IDS.projectId, workspace: folder };
  });

/**
 * Before the restart: the project, the thread, and the message with the code
 * word. `withoutProject` puts the thread in "No project", so its first
 * message claims it a folder of its own.
 */
export const runFirstTurn = (
  harness: Harness,
  scenario: RestartResumeScenario = RESTART_RESUME_SCENARIO,
  options: { readonly withoutProject?: boolean } = {},
) =>
  Effect.gen(function* () {
    const { projectId, workspace } = options.withoutProject
      ? { ...(yield* harness.projects.ensureScratchProject), workspace: undefined }
      : yield* makeResumedGameProject(harness);
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:restart-resume:thread"),
      threadId: RESTART_RESUME_IDS.threadId,
      projectId,
      title: "New thread",
      modelSelection: { instanceId: scenario.instanceId, model: scenario.model },
      runtimeMode: scenario.modes?.runtimeMode ?? "full-access",
      ...(scenario.modes === undefined ? {} : { interactionMode: scenario.modes.interactionMode }),
    });
    const run = yield* sendAndAwait(harness, 1, scenario.firstPrompt);
    // A thread without a project works in the folder its first message claimed.
    const thread = yield* harness.orchestrator.getThreadProjection(RESTART_RESUME_IDS.threadId);
    return {
      workspace:
        workspace ??
        Option.getOrThrow(Option.flatMapNullishOr(thread, (p) => p.thread.worktreePath)),
      run,
    };
  });

/** After the restart: any change of modes, then the question only the earlier conversation answers. */
export const runSecondTurn = (
  harness: Harness,
  scenario: RestartResumeScenario = RESTART_RESUME_SCENARIO,
) =>
  Effect.gen(function* () {
    const modes = scenario.modesAfterRestart;
    if (modes !== undefined) {
      yield* harness.orchestrator.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("command:restart-resume:runtime-mode"),
        threadId: RESTART_RESUME_IDS.threadId,
        runtimeMode: modes.runtimeMode,
      });
      yield* harness.orchestrator.dispatch({
        type: "thread.interaction-mode.set",
        commandId: CommandId.make("command:restart-resume:interaction-mode"),
        threadId: RESTART_RESUME_IDS.threadId,
        interactionMode: modes.interactionMode,
      });
    }
    return yield* sendAndAwait(harness, 2, scenario.secondPrompt);
  });

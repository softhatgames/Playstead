import type { MessageId, RunId } from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2AppThread,
  type OrchestrationV2Command,
  type OrchestrationV2PlanArtifact,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
} from "@playstead/contracts/orchestrationV2";
import { modelSelectionsEqual } from "@playstead/shared/model";
import { latestExecutedRun } from "@playstead/shared/orchestrationV2ThreadError";
import * as Result from "effect/Result";

import { decideMessageDispatch, resolveMessageDispatchIntent } from "./CommandPolicy.ts";
import type { NewDomainEvent } from "./EventSink.ts";
import type { PendingEffect } from "./EffectOutbox.ts";
import { cancelQueuedRun } from "./QueueCommands.ts";
import {
  reject,
  requireQueuedRun,
  requireThread,
  type ThreadCommandDecision,
  type ThreadCommandIds,
  type ThreadCommandInput,
  type ThreadCommandResult,
  type ThreadCommandState,
} from "./ThreadCommandDecision.ts";
import { threadTitleGenerationEffect } from "./ThreadLifecycle.ts";

type MessageDispatchCommand = Extract<OrchestrationV2Command, { type: "message.dispatch" }>;

/**
 * `message.dispatch`, as T3 Code's `dispatchMessage`
 * (`apps/server/src/orchestration-v2/Orchestrator.ts` at 2577baf) decides
 * it: the message starts a run when no run is active, steers the active
 * run's turn when its dispatch mode or delivery intent says so, and
 * otherwise queues a run behind it (`CommandPolicy.ts`). A steer whose turn
 * has already ended starts a run instead. A model selection the message
 * carries (the composer's traits) must name the thread's own instance; a
 * started run makes it the thread's first, and a queued run keeps it until
 * it starts. **Resume** continues an interrupted run that is the thread's
 * latest. A message that implements a proposed plan (`sourcePlanRef`,
 * perhaps another thread's in the same project) needs the plan still
 * active, and completes it.
 *
 * Whichever way it goes, a message brings the thread back to active work
 * and wakes it, and the first one titles it and asks a provider for a
 * better title (`messageArrival`).
 */
export const decideMessageDispatchCommand = (
  input: ThreadCommandInput<MessageDispatchCommand>,
): ThreadCommandResult =>
  Result.gen(function* () {
    const { command, state, ids, now } = input;
    const projection = yield* requireThread(command, state);
    if (
      command.modelSelection !== undefined &&
      command.modelSelection.instanceId !== projection.thread.providerInstanceId
    ) {
      return yield* reject(
        command,
        `Thread ${projection.thread.id} runs on ${projection.thread.providerInstanceId}. Choose one of its models; switching provider is not available yet.`,
      );
    }
    let sourcePlan: SourcePlan | undefined;
    if (command.sourcePlanRef !== undefined) {
      const { threadId, planId } = command.sourcePlanRef;
      const source = state.sourcePlanThread;
      const plan = source?.plans.find((candidate) => candidate.id === planId);
      if (source === undefined || plan?.kind !== "proposed_plan") {
        return yield* reject(
          command,
          `Proposed plan ${planId} does not exist on thread ${threadId}.`,
        );
      }
      if (source.thread.projectId !== projection.thread.projectId) {
        return yield* reject(command, `Proposed plan ${planId} belongs to a different project.`);
      }
      if (plan.status !== "active") {
        return yield* reject(command, `Proposed plan ${planId} is not active.`);
      }
      sourcePlan = plan;
    }
    if (command.manualContinuationOfRunId !== undefined) {
      const source = projection.runs.find((run) => run.id === command.manualContinuationOfRunId);
      if (
        command.dispatchMode.type !== "start_immediately" ||
        source?.status !== "interrupted" ||
        latestExecutedRun(projection.runs)?.id !== source.id ||
        projection.runtimeRequests.some((request) => request.status === "pending")
      ) {
        return yield* reject(command, "This thread can no longer be resumed from that run.");
      }
    }
    const arrival = messageArrival(command, projection, now);
    const arrived = { ...projection, thread: arrival.thread };
    const dispatchMode = lateSteerFallback(
      arrived,
      resolveMessageDispatchIntent(arrived, command, state),
    );
    const decision = yield* decideMessageDispatch(command, arrived, dispatchMode, state);
    const decided: ThreadCommandDecision =
      decision.type === "steer_active"
        ? yield* steerIntoRun({
            command,
            state,
            projection: arrived,
            targetRunId: decision.targetRunId,
            message: { id: command.messageId, text: command.text },
            modelSelection: command.modelSelection ?? arrived.thread.modelSelection,
            inputIntent: "steer",
            precedingEvents: [],
            ids,
            now,
          })
        : decision.type === "start_run"
          ? startRun(command, arrived, sourcePlan, ids, now, state.worktreePath)
          : queueMessage(command, arrived, sourcePlan, ids, now);
    return {
      ...decided,
      events: [...arrival.events, ...decided.events],
      effects: [...arrival.effects, ...decided.effects],
    };
  });

/**
 * What a message does to its thread before it starts, steers or queues
 * anything (T3 Code's `dispatchMessage`, in its order): it clears a settle
 * or un-settle the person set, so automatic settlement follows its usual
 * rules again; it wakes a snoozed thread, without stamping
 * `lastSnoozeWakeAt`; and the first message titles the thread with its seed
 * and asks a provider for a better title beside the turn.
 */
function messageArrival(
  command: MessageDispatchCommand,
  projection: OrchestrationV2ThreadProjection,
  now: string,
): {
  readonly thread: OrchestrationV2AppThread;
  readonly events: ReadonlyArray<NewDomainEvent>;
  readonly effects: ReadonlyArray<PendingEffect>;
} {
  const threadId = projection.thread.id;
  const events: Array<NewDomainEvent> = [];
  const effects: Array<PendingEffect> = [];
  let thread = projection.thread;
  if (thread.settledOverride !== null) {
    thread = {
      ...thread,
      settledOverride: null,
      settledAt: null,
      unsettledAt: thread.settledOverride === "active" ? thread.unsettledAt : now,
      updatedAt: now,
    };
    events.push({ type: "thread.unsettled", threadId, occurredAt: now, payload: thread });
  }
  if (thread.snoozedUntil !== null) {
    thread = { ...thread, snoozedUntil: null, snoozedAt: null, updatedAt: now };
    events.push({ type: "thread.unsnoozed", threadId, occurredAt: now, payload: thread });
  }
  if (command.titleSeed !== undefined && projection.messages.length === 0) {
    thread = {
      ...thread,
      title: command.titleSeed,
      titleRegeneration: { requestId: command.commandId, startedAt: now },
      updatedAt: now,
    };
    events.push({ type: "thread.metadata-updated", threadId, occurredAt: now, payload: thread });
    effects.push(
      threadTitleGenerationEffect(command.commandId, {
        type: "initial",
        messageId: command.messageId,
      }),
    );
  }
  return { thread, events, effects };
}

/**
 * `queued-message.promote-to-steer` removes a queued run and steers the
 * active run with its message, with the thread's selection, all or nothing
 * (T3 Code's `dispatchQueuedMessagePromoteToSteer`).
 */
export const decidePromoteToSteer = (
  input: ThreadCommandInput<
    Extract<OrchestrationV2Command, { type: "queued-message.promote-to-steer" }>
  >,
): ThreadCommandResult =>
  Result.gen(function* () {
    const { command, state, ids, now } = input;
    const projection = yield* requireThread(command, state);
    const queuedRun = yield* requireQueuedRun(
      command,
      projection.runs,
      command.queuedRunId,
      "Queued run",
    );
    const message = projection.messages.find(
      (candidate) => candidate.id === queuedRun.userMessageId,
    );
    if (message === undefined) {
      return yield* reject(command, `Queued run ${queuedRun.id} is missing its message.`);
    }
    return yield* steerIntoRun({
      command,
      state,
      projection,
      targetRunId: command.targetRunId,
      message: { id: message.id, text: message.text },
      modelSelection: projection.thread.modelSelection,
      inputIntent: "promoted_queued_to_steer",
      precedingEvents: cancelQueuedRun(projection, queuedRun, now),
      ids,
      now,
    });
  });

/**
 * A steer whose turn has already ended starts a run of its own instead (T3
 * Code's fallback in `dispatchMessage`): the person may have seen the turn
 * running a moment before it ended, and the message must not be lost.
 */
function lateSteerFallback(
  projection: OrchestrationV2ThreadProjection,
  dispatchMode: MessageDispatchCommand["dispatchMode"],
): MessageDispatchCommand["dispatchMode"] {
  if (dispatchMode.type !== "steer_active") return dispatchMode;
  const target = projection.runs.find((run) => run.id === dispatchMode.targetRunId);
  if (target === undefined) return dispatchMode;
  const turn = projection.providerTurns.findLast(
    (candidate) => candidate.runAttemptId === target.activeAttemptId,
  );
  const ended =
    target.status === "completed" ||
    ((target.status === "running" || target.status === "waiting") && turn?.status === "completed");
  return ended ? { type: "start_immediately" } : dispatchMode;
}

/**
 * A message sent into a run's running turn (the active-steering branch of
 * T3 Code's `dispatchSteerIntoRun`): the run must be running a provider
 * turn on a session, and its provider must steer. The message joins the
 * run, its user item is marked as a steer (or a promoted queued message),
 * a selection that differs becomes the thread's for its next turn, and the
 * provider is given the message (`provider-turn.steer`). Events a caller
 * makes first, such as a promoted queued run's cancellation, come before.
 */
function steerIntoRun(input: {
  readonly command: OrchestrationV2Command;
  readonly state: ThreadCommandState;
  readonly projection: OrchestrationV2ThreadProjection;
  readonly targetRunId: RunId;
  readonly message: { readonly id: MessageId; readonly text: string };
  readonly modelSelection: OrchestrationV2AppThread["modelSelection"];
  readonly inputIntent: "steer" | "promoted_queued_to_steer";
  readonly precedingEvents: ReadonlyArray<NewDomainEvent>;
  readonly ids: ThreadCommandIds;
  readonly now: string;
}): ThreadCommandResult {
  const { command, projection, ids, now } = input;
  const target = projection.runs.find((run) => run.id === input.targetRunId);
  if (target === undefined)
    return reject(command, `Target run ${input.targetRunId} was not found.`);
  if (target.rootNodeId === null) {
    return reject(command, `Target run ${target.id} has no root node.`);
  }
  if (target.status !== "running") {
    return reject(command, `Target run ${target.id} is ${target.status} and cannot be steered.`);
  }
  const providerThread = projection.providerThreads.find(
    (candidate) => candidate.id === target.providerThreadId,
  );
  if (providerThread === undefined || providerThread.providerSessionId === null) {
    return reject(
      command,
      `Provider thread ${target.providerThreadId} has no active provider session for steering.`,
    );
  }
  const providerTurn = projection.providerTurns.find(
    (turn) => turn.runAttemptId === target.activeAttemptId && turn.status === "running",
  );
  if (providerTurn === undefined) {
    return reject(command, `No running provider turn found for active run ${target.id}.`);
  }
  if (!input.state.supportsActiveSteering) {
    return reject(command, `${target.providerInstanceId} cannot steer active turns.`);
  }
  const { thread } = projection;
  const base = { threadId: thread.id, runId: target.id, occurredAt: now };
  return Result.succeed({
    events: [
      ...input.precedingEvents,
      ...(modelSelectionsEqual(thread.modelSelection, input.modelSelection)
        ? []
        : [
            {
              type: "thread.model-selection-updated",
              threadId: thread.id,
              occurredAt: now,
              payload: { ...thread, modelSelection: input.modelSelection, updatedAt: now },
            } as const,
          ]),
      {
        ...base,
        type: "message.updated",
        payload: {
          id: input.message.id,
          threadId: thread.id,
          runId: target.id,
          nodeId: target.rootNodeId,
          role: "user",
          text: input.message.text,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        ...base,
        type: "turn-item.updated",
        payload: {
          id: ids.userItemId,
          threadId: thread.id,
          runId: target.id,
          nodeId: target.rootNodeId,
          providerThreadId: providerThread.id,
          providerTurnId: providerTurn.id,
          ordinal: 0,
          status: "completed",
          title: null,
          startedAt: now,
          completedAt: now,
          updatedAt: now,
          type: "user_message",
          messageId: input.message.id,
          text: input.message.text,
          inputIntent: input.inputIntent,
        },
      },
    ],
    effects: [
      {
        id: ids.effectId,
        request: {
          type: "provider-turn.steer",
          runId: target.id,
          providerSessionId: providerThread.providerSessionId,
          providerThreadId: providerThread.id,
          providerTurnId: providerTurn.id,
          messageId: input.message.id,
        },
      },
    ],
  });
}

type SourcePlan = Extract<OrchestrationV2PlanArtifact, { kind: "proposed_plan" }>;

/** The plan a message implements is done, as T3 Code's `completeSourcePlan` marks it. */
const completedSourcePlan = (
  sourcePlan: SourcePlan | undefined,
  now: string,
): ReadonlyArray<NewDomainEvent> =>
  sourcePlan === undefined
    ? []
    : [
        {
          type: "plan.updated",
          threadId: sourcePlan.threadId,
          ...(sourcePlan.runId === null ? {} : { runId: sourcePlan.runId }),
          occurredAt: now,
          payload: { ...sourcePlan, status: "completed" },
        },
      ];

/** A message that starts a run of its own (the start branch of T3 Code's `dispatchMessage`). */
function startRun(
  command: MessageDispatchCommand,
  projection: OrchestrationV2ThreadProjection,
  sourcePlan: SourcePlan | undefined,
  ids: ThreadCommandIds,
  now: string,
  claimedWorktreePath: string | undefined,
): ThreadCommandDecision {
  const threadId = projection.thread.id;
  const runId = ids.runId;
  const ordinal = projection.runs.reduce((highest, run) => Math.max(highest, run.ordinal), 0) + 1;
  const events: Array<NewDomainEvent> = [];

  // The message's model and options become the thread's first, as T3
  // Code's `dispatchMessage` does, and its run copies them.
  const modelSelection = command.modelSelection ?? projection.thread.modelSelection;
  const thread = modelSelectionsEqual(projection.thread.modelSelection, modelSelection)
    ? projection.thread
    : { ...projection.thread, modelSelection, updatedAt: now };
  if (thread !== projection.thread) {
    events.push({
      type: "thread.model-selection-updated",
      threadId,
      occurredAt: now,
      payload: thread,
    });
  }

  const existingProviderThread = projection.providerThreads.find(
    (providerThread) => providerThread.id === thread.activeProviderThreadId,
  );
  const providerThread: OrchestrationV2ProviderThread = existingProviderThread ?? {
    id: ids.providerThreadId,
    driver: thread.providerInstanceId,
    providerInstanceId: thread.providerInstanceId,
    providerSessionId: null,
    appThreadId: threadId,
    nativeThreadRef: null,
    status: "not_loaded",
    firstRunOrdinal: ordinal,
    lastRunOrdinal: null,
    createdAt: now,
    updatedAt: now,
  };

  // A thread without a project runs in the folder claimed for it (T3 Code's
  // `ThreadLaunchService` turning a root launch into `existing_worktree`).
  const worktreePath = thread.worktreePath ?? claimedWorktreePath ?? null;
  if (existingProviderThread === undefined || worktreePath !== thread.worktreePath) {
    events.push({
      type: "thread.metadata-updated",
      threadId,
      occurredAt: now,
      payload: {
        ...thread,
        worktreePath,
        activeProviderThreadId: providerThread.id,
        updatedAt: now,
      },
    });
  }
  if (existingProviderThread === undefined) {
    events.push({
      type: "provider-thread.updated",
      threadId,
      runId,
      occurredAt: now,
      payload: providerThread,
    });
  }

  const run: OrchestrationV2Run = {
    id: runId,
    threadId,
    ordinal,
    providerInstanceId: thread.providerInstanceId,
    modelSelection: thread.modelSelection,
    providerThreadId: providerThread.id,
    userMessageId: command.messageId as MessageId,
    rootNodeId: ids.rootNodeId,
    activeAttemptId: ids.attemptId,
    status: "starting",
    requestedAt: now,
    startedAt: null,
    completedAt: null,
    ...(command.sourcePlanRef === undefined ? {} : { sourcePlanRef: command.sourcePlanRef }),
  };
  events.push(
    { type: "run.created", threadId, runId, occurredAt: now, payload: run },
    {
      type: "run-attempt.created",
      threadId,
      runId,
      occurredAt: now,
      payload: {
        id: ids.attemptId,
        runId,
        attemptOrdinal: 1,
        rootNodeId: ids.rootNodeId,
        providerInstanceId: thread.providerInstanceId,
        providerThreadId: providerThread.id,
        providerTurnId: null,
        reason: "initial",
        status: "pending",
        startedAt: null,
        completedAt: null,
      },
    },
    {
      type: "node.updated",
      threadId,
      runId,
      occurredAt: now,
      payload: {
        id: ids.rootNodeId,
        threadId,
        runId,
        parentNodeId: null,
        rootNodeId: ids.rootNodeId,
        kind: "root_turn",
        status: "pending",
        providerThreadId: providerThread.id,
        providerTurnId: null,
        startedAt: null,
        completedAt: null,
      },
    },
    {
      type: "message.updated",
      threadId,
      runId,
      occurredAt: now,
      payload: {
        id: command.messageId,
        threadId,
        runId,
        nodeId: ids.rootNodeId,
        role: "user",
        text: command.text,
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    },
    {
      type: "turn-item.updated",
      threadId,
      runId,
      occurredAt: now,
      payload: {
        // A steer that came too late starts its run with the item it
        // already has, as T3 Code's item id derived from the message keeps it.
        id:
          projection.turnItems.find(
            (item) => item.type === "user_message" && item.messageId === command.messageId,
          )?.id ?? ids.userItemId,
        threadId,
        runId,
        nodeId: ids.rootNodeId,
        providerThreadId: providerThread.id,
        providerTurnId: null,
        ordinal: 0,
        status: "completed",
        title: null,
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        type: "user_message",
        messageId: command.messageId,
        text: command.text,
        inputIntent: "turn_start",
      },
    },
  );

  events.push(...completedSourcePlan(sourcePlan, now));

  return {
    events,
    effects: [{ id: ids.effectId, request: { type: "provider-turn.start", runId } }],
  };
}

/**
 * A message that waits behind the active run (the queue branch of T3 Code's
 * `dispatchMessage`): a `queued` run at the end of the queue, held if the
 * queue is, with its attempt, root node and message. The run keeps the
 * model selection the message carried; the thread takes it when the run
 * starts. The message reaches the timeline then, too.
 */
function queueMessage(
  command: MessageDispatchCommand,
  projection: OrchestrationV2ThreadProjection,
  sourcePlan: SourcePlan | undefined,
  ids: ThreadCommandIds,
  now: string,
): ThreadCommandDecision {
  const { thread } = projection;
  const threadId = thread.id;
  const runId = ids.runId;
  const ordinal = projection.runs.reduce((highest, run) => Math.max(highest, run.ordinal), 0) + 1;
  const events: Array<NewDomainEvent> = [];
  const providerThreadId =
    thread.activeProviderThreadId ??
    projection.runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status))?.providerThreadId ??
    ids.providerThreadId;
  const queued = projection.runs.filter((run) => run.status === "queued");
  const run: OrchestrationV2Run = {
    id: runId,
    threadId,
    ordinal,
    providerInstanceId: thread.providerInstanceId,
    modelSelection: command.modelSelection ?? thread.modelSelection,
    providerThreadId,
    userMessageId: command.messageId,
    rootNodeId: ids.rootNodeId,
    activeAttemptId: ids.attemptId,
    status: "queued",
    queuePosition:
      Math.max(0, ...queued.map((candidate) => candidate.queuePosition ?? candidate.ordinal)) + 1,
    ...(queued.some((candidate) => candidate.queueHeld === true) ? { queueHeld: true } : {}),
    requestedAt: now,
    startedAt: null,
    completedAt: null,
    ...(command.sourcePlanRef === undefined ? {} : { sourcePlanRef: command.sourcePlanRef }),
  };
  const base = { threadId, runId, occurredAt: now };
  events.push(
    { ...base, type: "run.created", payload: run },
    {
      ...base,
      type: "run-attempt.created",
      payload: {
        id: ids.attemptId,
        runId,
        attemptOrdinal: 1,
        rootNodeId: ids.rootNodeId,
        providerInstanceId: thread.providerInstanceId,
        providerThreadId,
        providerTurnId: null,
        reason: "initial",
        status: "pending",
        startedAt: null,
        completedAt: null,
      },
    },
    {
      ...base,
      type: "node.updated",
      payload: {
        id: ids.rootNodeId,
        threadId,
        runId,
        parentNodeId: null,
        rootNodeId: ids.rootNodeId,
        kind: "root_turn",
        status: "pending",
        providerThreadId,
        providerTurnId: null,
        startedAt: null,
        completedAt: null,
      },
    },
    {
      ...base,
      type: "message.updated",
      payload: {
        id: command.messageId,
        threadId,
        runId,
        nodeId: ids.rootNodeId,
        role: "user",
        text: command.text,
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    },
  );
  events.push(...completedSourcePlan(sourcePlan, now));
  return { events, effects: [] };
}

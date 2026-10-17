import {
  type MessageId,
  type NodeId,
  type ProviderSessionId,
  type ProviderThreadId,
  type RunAttemptId,
  type RunId,
  TurnItemId,
} from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type OrchestrationV2AppThread,
  type OrchestrationV2Command,
  type OrchestrationV2PlanArtifact,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  type ProviderApprovalDecision,
  type ProviderUserInputAnswers,
} from "@playstead/contracts/orchestrationV2";
import { modelSelectionsEqual } from "@playstead/shared/model";
import { latestExecutedRun } from "@playstead/shared/orchestrationRuns";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { CancelUnsettledEffects, PendingEffect } from "./EffectOutbox.ts";
import type { NewDomainEvent } from "./EventSink.ts";

/** Why a thread command was refused; the reason is kept in its receipt. */
export class ThreadCommandRejection extends Schema.TaggedError<ThreadCommandRejection>()(
  "ThreadCommandRejection",
  { commandType: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/** What a command is decided against, read under the thread's lock. */
export interface ThreadCommandState {
  readonly projection: OrchestrationV2ThreadProjection | undefined;
  /** For `thread.create`: whether the project exists. */
  readonly projectExists: boolean;
  /** For `thread.create`: whether the provider instance can run a thread. */
  readonly instanceHasAdapter: boolean;
  /**
   * For a `message.dispatch` that implements a plan: the projection of the
   * thread its `sourcePlanRef` names, which may be another thread.
   */
  readonly sourcePlanThread?: OrchestrationV2ThreadProjection | undefined;
  /** For `message.dispatch`: whether the thread's adapter can queue a message behind an active run. */
  readonly supportsQueuedMessages: boolean;
  /** For `message.dispatch` and promotion: whether the thread's adapter can steer a running turn. */
  readonly supportsActiveSteering: boolean;
}

/** Ids a message needs, allocated before deciding so the decision stays pure. */
export interface ThreadCommandIds {
  readonly runId: RunId;
  readonly attemptId: RunAttemptId;
  readonly rootNodeId: NodeId;
  readonly providerThreadId: ProviderThreadId;
  readonly userItemId: TurnItemId;
  readonly effectId: string;
}

export interface ThreadCommandDecision {
  readonly events: ReadonlyArray<NewDomainEvent>;
  readonly effects: ReadonlyArray<PendingEffect>;
  /** The thread's effects the command makes moot, cancelled in its commit. */
  readonly cancelUnsettledEffects?: CancelUnsettledEffects;
}

/**
 * The interrupt's two turn items, one pair per run (T3 Code's
 * `runSignalTurnItem` ids): the request, and the result that names it.
 */
export const interruptRequestItemId = (runId: RunId) =>
  TurnItemId.make(`item:${runId}:interrupt-request`);
const interruptResultItemId = (runId: RunId) => TurnItemId.make(`item:${runId}:interrupt-result`);

/** The item that marks a run interrupted, as T3 Code's `makeInterruptResultTurnItem` builds it. */
export const interruptResultItem = (input: {
  readonly run: OrchestrationV2Run;
  readonly providerTurnId: OrchestrationV2TurnItem["providerTurnId"];
  readonly message: string;
  readonly now: string;
}): OrchestrationV2TurnItem => ({
  id: interruptResultItemId(input.run.id),
  threadId: input.run.threadId,
  runId: input.run.id,
  nodeId: input.run.rootNodeId,
  providerThreadId: input.run.providerThreadId,
  providerTurnId: input.providerTurnId,
  ordinal: 0,
  status: "interrupted",
  title: "Interrupted",
  startedAt: input.now,
  completedAt: input.now,
  updatedAt: input.now,
  type: "run_interrupt_result",
  message: input.message,
  parentItemId: interruptRequestItemId(input.run.id),
});

const reject = (command: OrchestrationV2Command, reason: string) =>
  Result.fail(new ThreadCommandRejection({ commandType: command.type, reason }));

/**
 * Decides a thread command's events and effects, without I/O. T3 Code at
 * 2577baf decides inside `OrchestratorV2`'s `dispatchThreadCreate`,
 * `dispatchThreadMutation` and `dispatchMessage`
 * (`apps/server/src/orchestration-v2/Orchestrator.ts`); Playstead keeps the
 * same events in the same order as a pure function.
 *
 * - `thread.create` makes a thread in its runtime and interaction modes, for
 *   an existing project and an instance that can run it.
 * - `thread.model-selection.set` changes the model the thread's next run
 *   copies. Naming another instance is T3 Code's provider switch, which
 *   Playstead refuses.
 * - `thread.runtime-mode.set` and `thread.interaction-mode.set` change the
 *   modes the thread's next turn starts in; as in T3 Code, an active run
 *   prevents neither.
 * - `message.dispatch` starts a run when no run is active, steers the
 *   active run's turn when its dispatch mode or delivery intent says so,
 *   and otherwise queues a run behind it (T3 Code's `CommandPolicy`). A
 *   steer whose turn has already ended starts a run instead. A model
 *   selection the message carries (the composer's traits) must name the
 *   thread's own instance; a started run makes it the thread's first, and
 *   a queued run keeps it until it starts. **Resume** continues an
 *   interrupted run that is the thread's latest. A message that implements
 *   a proposed plan (`sourcePlanRef`, perhaps another thread's in the same
 *   project) needs the plan still active, and completes it.
 * - `queued-message.promote-to-steer` removes a queued run and steers the
 *   active run with its message.
 * - `queue.resume`, `queued-run.reorder`, `queued-run.cancel` and
 *   `queued-run.edit` release, reorder, remove and rewrite queued runs, as
 *   T3 Code's do; the orchestrator starts the next queued run after a
 *   resume, and after a run ends (`decideNextQueuedRun`).
 * - `run.interrupt` stops an active run, as T3 Code's `dispatchRunInterrupt`
 *   does: a run whose provider turn has not started ends interrupted at
 *   once and its start is cancelled; otherwise the provider is asked to
 *   stop, and the run ends when its turn does. With `holdQueue` (**Stop**)
 *   the queued runs are held too.
 * - `runtime-request.respond` answers a request still pending and
 *   answerable: an approval with a decision, questions once each has an
 *   answer; the provider is given them.
 */
export function decideThreadCommand(input: {
  readonly command: OrchestrationV2Command;
  readonly state: ThreadCommandState;
  readonly ids: ThreadCommandIds;
  readonly now: string;
}): Result.Result<ThreadCommandDecision, ThreadCommandRejection> {
  const { command, state, ids, now } = input;
  switch (command.type) {
    case "thread.create": {
      if (state.projection !== undefined) {
        return reject(command, `Thread ${command.threadId} already exists.`);
      }
      if (!state.projectExists) {
        return reject(command, `Project ${command.projectId} does not exist.`);
      }
      if (!state.instanceHasAdapter) {
        return reject(
          command,
          `Provider instance ${command.modelSelection.instanceId} cannot run threads yet.`,
        );
      }
      const thread: OrchestrationV2AppThread = {
        id: command.threadId,
        projectId: command.projectId,
        title: command.title,
        providerInstanceId: command.modelSelection.instanceId,
        modelSelection: command.modelSelection,
        runtimeMode: command.runtimeMode,
        interactionMode: command.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
        activeProviderThreadId: null,
        createdAt: now,
        updatedAt: now,
      };
      return Result.succeed({
        events: [{ type: "thread.created", threadId: thread.id, occurredAt: now, payload: thread }],
        effects: [],
      });
    }
    case "thread.model-selection.set": {
      const projection = state.projection;
      if (projection === undefined) {
        return reject(command, `Thread ${command.threadId} does not exist.`);
      }
      const { thread } = projection;
      if (command.modelSelection.instanceId !== thread.providerInstanceId) {
        return reject(
          command,
          `Thread ${thread.id} runs on ${thread.providerInstanceId}. Choose one of its models; switching provider is not available yet.`,
        );
      }
      return Result.succeed({
        events: [
          {
            type: "thread.model-selection-updated",
            threadId: thread.id,
            occurredAt: now,
            payload: { ...thread, modelSelection: command.modelSelection, updatedAt: now },
          },
        ],
        effects: [],
      });
    }
    case "thread.runtime-mode.set": {
      const projection = state.projection;
      if (projection === undefined) {
        return reject(command, `Thread ${command.threadId} does not exist.`);
      }
      const { thread } = projection;
      return Result.succeed({
        events: [
          {
            type: "thread.runtime-mode-updated",
            threadId: thread.id,
            occurredAt: now,
            payload: { ...thread, runtimeMode: command.runtimeMode, updatedAt: now },
          },
        ],
        effects: [],
      });
    }
    case "thread.interaction-mode.set": {
      const projection = state.projection;
      if (projection === undefined) {
        return reject(command, `Thread ${command.threadId} does not exist.`);
      }
      const { thread } = projection;
      return Result.succeed({
        events: [
          {
            type: "thread.interaction-mode-updated",
            threadId: thread.id,
            occurredAt: now,
            payload: { ...thread, interactionMode: command.interactionMode, updatedAt: now },
          },
        ],
        effects: [],
      });
    }
    case "message.dispatch": {
      const projection = state.projection;
      if (projection === undefined) {
        return reject(command, `Thread ${command.threadId} does not exist.`);
      }
      if (
        command.modelSelection !== undefined &&
        command.modelSelection.instanceId !== projection.thread.providerInstanceId
      ) {
        return reject(
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
          return reject(command, `Proposed plan ${planId} does not exist on thread ${threadId}.`);
        }
        if (source.thread.projectId !== projection.thread.projectId) {
          return reject(command, `Proposed plan ${planId} belongs to a different project.`);
        }
        if (plan.status !== "active") {
          return reject(command, `Proposed plan ${planId} is not active.`);
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
          return reject(command, "This thread can no longer be resumed from that run.");
        }
      }
      const dispatchMode = lateSteerFallback(
        projection,
        resolveMessageDispatchIntent(projection, command, state),
      );
      if (dispatchMode.type === "steer_active") {
        return steerIntoRun({
          command,
          state,
          projection,
          targetRunId: dispatchMode.targetRunId,
          message: { id: command.messageId, text: command.text },
          modelSelection: command.modelSelection ?? projection.thread.modelSelection,
          inputIntent: "steer",
          precedingEvents: [],
          ids,
          now,
        });
      }
      // Otherwise a message sent while a run is active waits behind it, as
      // T3 Code's `decideMessageDispatch` decides.
      const active = projection.runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status));
      if (active === undefined) {
        return Result.succeed(dispatchMessage(command, projection, sourcePlan, ids, now));
      }
      if (!state.supportsQueuedMessages) {
        return reject(
          command,
          `${projection.thread.providerInstanceId} cannot queue a message while run ${active.id} is active.`,
        );
      }
      return Result.succeed(queueMessage(command, projection, sourcePlan, ids, now));
    }
    case "queued-message.promote-to-steer": {
      const projection = state.projection;
      if (projection === undefined) {
        return reject(command, `Thread ${command.threadId} does not exist.`);
      }
      const queuedRun = projection.runs.find((run) => run.id === command.queuedRunId);
      if (queuedRun === undefined || queuedRun.status !== "queued") {
        return reject(command, `Queued run ${command.queuedRunId} is not queued.`);
      }
      const message = projection.messages.find(
        (candidate) => candidate.id === queuedRun.userMessageId,
      );
      if (message === undefined) {
        return reject(command, `Queued run ${queuedRun.id} is missing its message.`);
      }
      // The queued run goes, and its message steers the target instead,
      // with the thread's selection (T3 Code's `dispatchQueuedMessagePromoteToSteer`).
      return steerIntoRun({
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
    }
    case "queue.resume": {
      const projection = state.projection;
      if (projection === undefined) {
        return reject(command, `Thread ${command.threadId} does not exist.`);
      }
      const queued = projection.runs.filter((run) => run.status === "queued");
      const base = { threadId: command.threadId, occurredAt: now };
      return Result.succeed({
        // A queue with nothing in it still records the resume, as T3 Code's does.
        events:
          queued.length === 0
            ? [{ ...base, type: "thread.metadata-updated", payload: projection.thread }]
            : queued.map((run) => ({
                ...base,
                runId: run.id,
                type: "run.updated",
                payload: { ...run, queueHeld: false },
              })),
        effects: [],
      });
    }
    case "queued-run.reorder": {
      const projection = state.projection;
      if (projection === undefined) {
        return reject(command, `Thread ${command.threadId} does not exist.`);
      }
      const queued = queuedRunsInDeliveryOrder(projection.runs);
      const moving = queued.find((run) => run.id === command.runId);
      if (moving === undefined) return reject(command, `Run ${command.runId} is not queued.`);
      const others = queued.filter((run) => run.id !== moving.id);
      const beforeIndex =
        command.beforeRunId === null
          ? others.length
          : others.findIndex((run) => run.id === command.beforeRunId);
      if (beforeIndex === -1) {
        return reject(command, `Queue target ${command.beforeRunId} is not queued.`);
      }
      const reordered = [...others.slice(0, beforeIndex), moving, ...others.slice(beforeIndex)];
      return Result.succeed({
        events: reordered.flatMap((run, index): ReadonlyArray<NewDomainEvent> =>
          run.queuePosition === index + 1
            ? []
            : [
                {
                  type: "run.updated",
                  threadId: command.threadId,
                  runId: run.id,
                  occurredAt: now,
                  payload: { ...run, queuePosition: index + 1 },
                },
              ],
        ),
        effects: [],
      });
    }
    case "queued-run.cancel": {
      const projection = state.projection;
      if (projection === undefined) {
        return reject(command, `Thread ${command.threadId} does not exist.`);
      }
      const run = projection.runs.find((candidate) => candidate.id === command.runId);
      if (run === undefined || run.status !== "queued") {
        return reject(command, `Run ${command.runId} is not queued.`);
      }
      return Result.succeed({ events: cancelQueuedRun(projection, run, now), effects: [] });
    }
    case "queued-run.edit": {
      if (command.text.trim().length === 0) {
        return reject(command, `Queued run ${command.runId} cannot be edited to an empty message.`);
      }
      const projection = state.projection;
      if (projection === undefined) {
        return reject(command, `Thread ${command.threadId} does not exist.`);
      }
      const run = projection.runs.find((candidate) => candidate.id === command.runId);
      if (run === undefined || run.status !== "queued") {
        return reject(command, `Run ${command.runId} is not queued.`);
      }
      const message = projection.messages.find((candidate) => candidate.id === run.userMessageId);
      if (message === undefined) {
        return reject(command, `Queued run ${run.id} has no user message.`);
      }
      return Result.succeed({
        events: [
          {
            type: "message.updated",
            threadId: command.threadId,
            runId: run.id,
            occurredAt: now,
            payload: { ...message, text: command.text, updatedAt: now },
          },
        ],
        effects: [],
      });
    }
    case "run.interrupt": {
      const projection = state.projection;
      if (projection === undefined) {
        return reject(command, `Thread ${command.threadId} does not exist.`);
      }
      const run = projection.runs.find((candidate) => candidate.id === command.runId);
      if (run === undefined) {
        return reject(command, `Run ${command.runId} is not in thread ${command.threadId}.`);
      }
      if (!ACTIVE_RUN_STATUSES.has(run.status)) {
        return reject(command, `Run ${run.id} has already ended ${run.status}.`);
      }
      const requestId = interruptRequestItemId(run.id);
      if (projection.turnItems.some((item) => item.id === requestId)) {
        return reject(command, `Run ${run.id} is already being interrupted.`);
      }
      const interrupted = dispatchRunInterrupt(projection, run, ids, now);
      return Result.succeed(
        command.holdQueue === true
          ? { ...interrupted, events: [...interrupted.events, ...holdQueue(projection, now)] }
          : interrupted,
      );
    }
    case "runtime-request.respond": {
      const projection = state.projection;
      if (projection === undefined) {
        return reject(command, `Thread ${command.threadId} does not exist.`);
      }
      const request = projection.runtimeRequests.find(
        (candidate) => candidate.id === command.requestId,
      );
      if (request === undefined) {
        return reject(command, `Runtime request ${command.requestId} was not found.`);
      }
      if (request.status !== "pending") {
        return reject(command, `Runtime request ${request.id} is ${request.status}.`);
      }
      if (request.responseCapability.type === "not_resumable") {
        return reject(command, request.responseCapability.reason);
      }
      const item = projection.turnItems.find(
        (candidate) =>
          (candidate.type === "approval_request" || candidate.type === "user_input_request") &&
          candidate.requestId === request.id,
      );
      if (request.kind === "user_input") {
        if (item?.type !== "user_input_request" || item.runId === null) {
          return reject(command, `The question for runtime request ${request.id} was not found.`);
        }
        const answers = command.answers;
        if (answers === undefined) return reject(command, "Answer each question before sending.");
        const unanswered = item.questions.some((question) => {
          const answer = answers[question.id];
          return typeof answer === "string"
            ? answer.trim().length === 0
            : answer === undefined || answer.length === 0;
        });
        if (unanswered) return reject(command, "Answer each question before sending.");
        return Result.succeed(
          dispatchRuntimeRequestRespond(
            projection,
            request,
            item,
            { answers },
            request.responseCapability.providerSessionId,
            item.runId,
            ids,
            now,
          ),
        );
      }
      if (item?.type !== "approval_request" || item.runId === null) {
        return reject(command, `The approval for runtime request ${request.id} was not found.`);
      }
      if (command.decision === undefined) {
        return reject(command, `Runtime request ${request.id} needs an approval decision.`);
      }
      return Result.succeed(
        dispatchRuntimeRequestRespond(
          projection,
          request,
          item,
          { decision: command.decision },
          request.responseCapability.providerSessionId,
          item.runId,
          ids,
          now,
        ),
      );
    }
  }
}

/**
 * The person answered a request (T3 Code's `dispatchRuntimeRequestRespond`,
 * live answers only): the request is resolved with the decision or the
 * answers, its node and item end, and the provider is given them. A
 * declined or cancelled approval ends its node and item cancelled; anything
 * else completes them.
 */
function dispatchRuntimeRequestRespond(
  projection: OrchestrationV2ThreadProjection,
  request: OrchestrationV2RuntimeRequest,
  item: Extract<OrchestrationV2TurnItem, { type: "approval_request" | "user_input_request" }>,
  answer:
    | { readonly decision: ProviderApprovalDecision }
    | { readonly answers: ProviderUserInputAnswers },
  providerSessionId: ProviderSessionId,
  runId: RunId,
  ids: ThreadCommandIds,
  now: string,
): ThreadCommandDecision {
  const base = { threadId: projection.thread.id, runId, occurredAt: now };
  const node = projection.nodes.find((candidate) => candidate.id === request.nodeId);
  const status =
    "decision" in answer && (answer.decision === "decline" || answer.decision === "cancel")
      ? ("cancelled" as const)
      : ("completed" as const);
  const answeredItem: OrchestrationV2TurnItem =
    item.type === "user_input_request" && "answers" in answer
      ? { ...item, answers: answer.answers, status, completedAt: now, updatedAt: now }
      : { ...item, status, completedAt: now, updatedAt: now };
  return {
    events: [
      {
        ...base,
        type: "runtime-request.updated",
        payload: { ...request, status: "resolved", resolvedAt: now, ...answer },
      },
      ...(node === undefined
        ? []
        : [
            {
              ...base,
              type: "node.updated",
              payload: { ...node, status, completedAt: now },
            } as const,
          ]),
      { ...base, type: "turn-item.updated", payload: answeredItem },
    ],
    effects: [
      {
        id: ids.effectId,
        request: {
          type: "runtime-request.respond",
          runId,
          providerSessionId,
          requestId: request.id,
          ...answer,
        },
      },
    ],
  };
}

function dispatchRunInterrupt(
  projection: OrchestrationV2ThreadProjection,
  run: OrchestrationV2Run,
  ids: ThreadCommandIds,
  now: string,
): ThreadCommandDecision {
  const base = { threadId: run.threadId, runId: run.id, occurredAt: now };
  const providerTurn = projection.providerTurns.find(
    (turn) => turn.runAttemptId === run.activeAttemptId && turn.status === "running",
  );
  const request: OrchestrationV2TurnItem = {
    id: interruptRequestItemId(run.id),
    threadId: run.threadId,
    runId: run.id,
    nodeId: run.rootNodeId,
    providerThreadId: run.providerThreadId,
    providerTurnId: providerTurn?.id ?? null,
    ordinal: 0,
    status: "completed",
    title: "Interrupt requested",
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    type: "run_interrupt_request",
    message: "Interrupt requested",
  };
  const requested: NewDomainEvent = { ...base, type: "turn-item.updated", payload: request };

  if (providerTurn !== undefined) {
    return {
      events: [requested],
      effects: [
        {
          id: ids.effectId,
          request: {
            type: "provider-turn.interrupt",
            runId: run.id,
            providerTurnId: providerTurn.id,
          },
        },
      ],
    };
  }

  // Nothing reached the provider yet: the run ends here, and its start is cancelled.
  const attempt = projection.attempts.find((candidate) => candidate.id === run.activeAttemptId);
  const rootNode = projection.nodes.find((candidate) => candidate.id === run.rootNodeId);
  return {
    events: [
      requested,
      {
        ...base,
        type: "turn-item.updated",
        payload: interruptResultItem({
          run,
          providerTurnId: null,
          message: "Run interrupted before the provider started",
          now,
        }),
      },
      ...(attempt === undefined
        ? []
        : [
            {
              ...base,
              type: "run-attempt.updated",
              payload: { ...attempt, status: "interrupted", completedAt: now },
            } as const,
          ]),
      ...(rootNode === undefined
        ? []
        : [
            {
              ...base,
              type: "node.updated",
              payload: { ...rootNode, status: "interrupted", completedAt: now },
            } as const,
          ]),
      {
        ...base,
        type: "run.updated",
        payload: { ...run, status: "interrupted", completedAt: now },
      },
    ],
    effects: [],
    cancelUnsettledEffects: {
      effectTypes: ["provider-turn.start"],
      reason: `Run ${run.id} was interrupted before its provider turn started.`,
    },
  };
}

type MessageDispatchCommand = Extract<OrchestrationV2Command, { type: "message.dispatch" }>;

/**
 * The dispatch mode a message's delivery intent leaves it (T3 Code's
 * `CommandPolicy.resolveMessageDispatchIntent` at 2577baf, without
 * `restart`): with nothing active the message starts a run; `steer` steers
 * the active run; `auto` queues behind a run still starting, and otherwise
 * steers when the provider can, else queues. T3 Code reads the live
 * session's capabilities, Playstead the adapter's, which are the same.
 */
function resolveMessageDispatchIntent(
  projection: OrchestrationV2ThreadProjection,
  command: MessageDispatchCommand,
  state: ThreadCommandState,
): MessageDispatchCommand["dispatchMode"] {
  if (command.deliveryIntent === undefined) return command.dispatchMode;
  const active = projection.runs.findLast((run) => ACTIVE_RUN_STATUSES.has(run.status));
  if (active === undefined) return { type: "start_immediately" };
  if (command.deliveryIntent === "steer") return { type: "steer_active", targetRunId: active.id };
  if (active.status === "starting") return { type: "queue_after_active" };
  return state.supportsActiveSteering
    ? { type: "steer_active", targetRunId: active.id }
    : { type: "queue_after_active" };
}

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
}): Result.Result<ThreadCommandDecision, ThreadCommandRejection> {
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

function dispatchMessage(
  command: Extract<OrchestrationV2Command, { type: "message.dispatch" }>,
  projection: OrchestrationV2ThreadProjection,
  sourcePlan: SourcePlan | undefined,
  ids: ThreadCommandIds,
  now: string,
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

  // The first message titles the thread, as T3 Code's title seed does.
  const titled =
    command.titleSeed !== undefined && projection.messages.length === 0
      ? command.titleSeed
      : thread.title;

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

  if (titled !== thread.title || existingProviderThread === undefined) {
    events.push({
      type: "thread.metadata-updated",
      threadId,
      occurredAt: now,
      payload: {
        ...thread,
        title: titled,
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

/** Queued runs in the order they start (T3 Code's `QueuedRunOrder.queuedRunsInDeliveryOrder`). */
const queuedRunsInDeliveryOrder = (
  runs: ReadonlyArray<OrchestrationV2Run>,
): ReadonlyArray<OrchestrationV2Run> =>
  runs
    .filter((run) => run.status === "queued")
    .toSorted(
      (left, right) =>
        (left.queuePosition ?? left.ordinal) - (right.queuePosition ?? right.ordinal) ||
        left.ordinal - right.ordinal,
    );

/** Every queued run not held yet becomes held (T3 Code's `holdStoppedThread`). */
const holdQueue = (
  projection: OrchestrationV2ThreadProjection,
  now: string,
): ReadonlyArray<NewDomainEvent> =>
  projection.runs.flatMap((run): ReadonlyArray<NewDomainEvent> =>
    run.status !== "queued" || run.queueHeld === true
      ? []
      : [
          {
            type: "run.updated",
            threadId: run.threadId,
            runId: run.id,
            occurredAt: now,
            payload: { ...run, queueHeld: true },
          },
        ],
  );

/** A queued run removed from the queue, with what was made for it (T3 Code's `dispatchQueuedRunCancel`). */
const cancelQueuedRun = (
  projection: OrchestrationV2ThreadProjection,
  run: OrchestrationV2Run,
  now: string,
): ReadonlyArray<NewDomainEvent> => {
  const base = { threadId: run.threadId, runId: run.id, occurredAt: now };
  const attempt = projection.attempts.find((candidate) => candidate.id === run.activeAttemptId);
  const rootNode = projection.nodes.find((candidate) => candidate.id === run.rootNodeId);
  return [
    {
      ...base,
      type: "run.updated",
      payload: { ...run, status: "cancelled", queuePosition: null, completedAt: now },
    },
    ...(attempt === undefined
      ? []
      : [
          {
            ...base,
            type: "run-attempt.updated",
            payload: { ...attempt, status: "cancelled", completedAt: now },
          } as const,
        ]),
    ...(rootNode === undefined
      ? []
      : [
          {
            ...base,
            type: "node.updated",
            payload: { ...rootNode, status: "cancelled", completedAt: now },
          } as const,
        ]),
  ];
};

/**
 * A message that waits behind the active run (the queue branch of T3 Code's
 * `dispatchMessage`): a `queued` run at the end of the queue, held if the
 * queue is, with its attempt, root node and message. The run keeps the
 * model selection the message carried; the thread takes it when the run
 * starts. The message reaches the timeline then, too.
 */
function queueMessage(
  command: Extract<OrchestrationV2Command, { type: "message.dispatch" }>,
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
  if (command.titleSeed !== undefined && projection.messages.length === 0) {
    events.push({
      type: "thread.metadata-updated",
      threadId,
      occurredAt: now,
      payload: { ...thread, title: command.titleSeed, updatedAt: now },
    });
  }
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

/**
 * What follows a run that ended, a resume, or a queued run removed (T3 Code's
 * `startNextQueuedRun` in `Orchestrator.ts`): nothing while a run is
 * active, the queue is empty or held. A run that failed with an error of
 * its own holds the queue, so one failure doesn't run every message behind
 * it (T3 Code lets a `validation_error` through; no Playstead failure has
 * that class). Otherwise the first queued run starts: the thread takes its
 * model selection, its message reaches the timeline as a `queued_turn`,
 * and its provider turn is started.
 */
export function decideNextQueuedRun(input: {
  readonly projection: OrchestrationV2ThreadProjection;
  /** The run whose end this follows, when it failed. */
  readonly failedRunId?: RunId;
  readonly ids: Pick<ThreadCommandIds, "userItemId" | "effectId">;
  readonly now: string;
}): ThreadCommandDecision | undefined {
  const { projection, ids, now } = input;
  const queued = queuedRunsInDeliveryOrder(projection.runs);
  const next = queued[0];
  if (
    next === undefined ||
    projection.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status)) ||
    queued.some((run) => run.queueHeld === true)
  ) {
    return undefined;
  }
  const failedRun = latestExecutedRun(projection.runs);
  const failedOnItsOwn =
    failedRun !== undefined &&
    failedRun.id === input.failedRunId &&
    failedRun.providerInstanceId === next.providerInstanceId &&
    projection.turnItems.some((item) => item.type === "error" && item.runId === failedRun.id);
  if (failedOnItsOwn) {
    const events = holdQueue(projection, now);
    return events.length === 0 ? undefined : { events, effects: [] };
  }
  const message = projection.messages.find((candidate) => candidate.id === next.userMessageId);
  if (message === undefined || next.rootNodeId === null) return undefined;
  const { thread } = projection;
  const base = { threadId: thread.id, runId: next.id, occurredAt: now };
  return {
    events: [
      ...(modelSelectionsEqual(thread.modelSelection, next.modelSelection)
        ? []
        : [
            {
              type: "thread.model-selection-updated",
              threadId: thread.id,
              occurredAt: now,
              payload: { ...thread, modelSelection: next.modelSelection, updatedAt: now },
            } as const,
          ]),
      {
        ...base,
        type: "turn-item.updated",
        payload: {
          id: ids.userItemId,
          threadId: thread.id,
          runId: next.id,
          nodeId: next.rootNodeId,
          providerThreadId: next.providerThreadId,
          providerTurnId: null,
          ordinal: 0,
          status: "completed",
          title: null,
          startedAt: now,
          completedAt: now,
          updatedAt: now,
          type: "user_message",
          messageId: message.id,
          text: message.text,
          inputIntent: "queued_turn",
        },
      },
      {
        ...base,
        type: "run.updated",
        payload: { ...next, status: "starting", queuePosition: null },
      },
    ],
    effects: [{ id: ids.effectId, request: { type: "provider-turn.start", runId: next.id } }],
  };
}

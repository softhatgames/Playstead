import type { RunId } from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2Command,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
} from "@playstead/contracts/orchestrationV2";
import { modelSelectionsEqual } from "@playstead/shared/model";
import { latestExecutedRun } from "@playstead/shared/orchestrationRuns";
import * as Result from "effect/Result";

import type { NewDomainEvent } from "./EventSink.ts";
import { queuedRunsInDeliveryOrder } from "./QueuedRunOrder.ts";
import {
  reject,
  requireQueuedRun,
  requireThread,
  type ThreadCommandDecision,
  type ThreadCommandIds,
  type ThreadCommandInput,
  type ThreadCommandResult,
} from "./ThreadCommandDecision.ts";

type QueueCommand = Extract<
  OrchestrationV2Command,
  { type: "queue.resume" | "queued-run.reorder" | "queued-run.cancel" | "queued-run.edit" }
>;

/**
 * `queue.resume`, `queued-run.reorder`, `queued-run.cancel` and
 * `queued-run.edit` release, reorder, remove and rewrite queued runs, as
 * T3 Code's `dispatchQueuedRunReorder`, `dispatchQueuedRunCancel` and
 * `dispatchQueuedRunEdit` (`apps/server/src/orchestration-v2/Orchestrator.ts`
 * at 2577baf) do; the orchestrator starts the next queued run after a
 * resume, and after a run ends (`decideNextQueuedRun`).
 */
export const decideQueueCommand = (input: ThreadCommandInput<QueueCommand>): ThreadCommandResult =>
  Result.gen(function* () {
    const { command, state, now } = input;
    if (command.type === "queued-run.edit" && command.text.trim().length === 0) {
      return yield* reject(
        command,
        `Queued run ${command.runId} cannot be edited to an empty message.`,
      );
    }
    const projection = yield* requireThread(command, state);
    switch (command.type) {
      case "queue.resume": {
        const queued = projection.runs.filter((run) => run.status === "queued");
        const base = { threadId: command.threadId, occurredAt: now };
        return {
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
        } satisfies ThreadCommandDecision;
      }
      case "queued-run.reorder": {
        const queued = queuedRunsInDeliveryOrder(projection.runs);
        const moving = yield* requireQueuedRun(command, queued, command.runId, "Run");
        const others = queued.filter((run) => run.id !== moving.id);
        const beforeIndex =
          command.beforeRunId === null
            ? others.length
            : others.indexOf(
                yield* requireQueuedRun(command, others, command.beforeRunId, "Queue target"),
              );
        const reordered = [...others.slice(0, beforeIndex), moving, ...others.slice(beforeIndex)];
        return {
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
        };
      }
      case "queued-run.cancel": {
        const run = yield* requireQueuedRun(command, projection.runs, command.runId, "Run");
        return { events: cancelQueuedRun(projection, run, now), effects: [] };
      }
      case "queued-run.edit": {
        const run = yield* requireQueuedRun(command, projection.runs, command.runId, "Run");
        const message = projection.messages.find((candidate) => candidate.id === run.userMessageId);
        if (message === undefined) {
          return yield* reject(command, `Queued run ${run.id} has no user message.`);
        }
        return {
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
        };
      }
    }
  });

/** Every queued run not held yet becomes held (T3 Code's `holdStoppedThread`). */
export const holdQueue = (
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
export const cancelQueuedRun = (
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

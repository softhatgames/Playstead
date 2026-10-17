import { type RunId, TurnItemId } from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2Command,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@playstead/contracts/orchestrationV2";
import * as Result from "effect/Result";

import type { NewDomainEvent } from "./EventSink.ts";
import { holdQueue } from "./QueueCommands.ts";
import {
  reject,
  requireThread,
  type ThreadCommandDecision,
  type ThreadCommandIds,
  type ThreadCommandInput,
  type ThreadCommandResult,
} from "./ThreadCommandDecision.ts";

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

/**
 * `run.interrupt` stops an active run, as T3 Code's `dispatchRunInterrupt`
 * (`apps/server/src/orchestration-v2/Orchestrator.ts` at 2577baf) does: a
 * run whose provider turn has not started ends interrupted at once and its
 * start is cancelled; otherwise the provider is asked to stop, and the run
 * ends when its turn does. With `holdQueue` (**Stop**) the queued runs are
 * held too.
 */
export const decideRunInterrupt = (
  input: ThreadCommandInput<Extract<OrchestrationV2Command, { type: "run.interrupt" }>>,
): ThreadCommandResult =>
  Result.gen(function* () {
    const { command, state, ids, now } = input;
    const projection = yield* requireThread(command, state);
    const run = projection.runs.find((candidate) => candidate.id === command.runId);
    if (run === undefined) {
      return yield* reject(command, `Run ${command.runId} is not in thread ${command.threadId}.`);
    }
    if (!ACTIVE_RUN_STATUSES.has(run.status)) {
      return yield* reject(command, `Run ${run.id} has already ended ${run.status}.`);
    }
    const requestId = interruptRequestItemId(run.id);
    if (projection.turnItems.some((item) => item.id === requestId)) {
      return yield* reject(command, `Run ${run.id} is already being interrupted.`);
    }
    const interrupted = dispatchRunInterrupt(projection, run, ids, now);
    return command.holdQueue === true
      ? { ...interrupted, events: [...interrupted.events, ...holdQueue(projection, now)] }
      : interrupted;
  });

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

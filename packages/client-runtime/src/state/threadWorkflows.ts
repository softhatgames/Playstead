import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
} from "@playstead/contracts/orchestrationV2";
import { latestExecutedRun } from "@playstead/shared/orchestrationRuns";

type Projection = Pick<OrchestrationV2ThreadProjection, "runs" | "messages">;

/** A queued run as the queued-runs control shows it. */
export interface QueuedThreadRun {
  readonly run: OrchestrationV2Run;
  readonly messageId: OrchestrationV2Run["userMessageId"];
  readonly text: string;
}

/**
 * The thread's queue as the composer reads it (T3 Code's
 * `deriveThreadQueueWorkflowState` in
 * `packages/client-runtime/src/state/threadWorkflows.ts` at 2577baf, without
 * steering): the active run, the queued runs in the order they start, and
 * whether the queue is held.
 */
export interface ThreadQueueWorkflowState {
  readonly activeRun: OrchestrationV2Run | null;
  readonly queuedRuns: ReadonlyArray<QueuedThreadRun>;
  readonly isHeld: boolean;
}

export function deriveThreadQueueWorkflowState(projection: Projection): ThreadQueueWorkflowState {
  const queuedRuns = projection.runs
    .filter((run) => run.status === "queued")
    .toSorted(
      (left, right) =>
        (left.queuePosition ?? left.ordinal) - (right.queuePosition ?? right.ordinal) ||
        left.ordinal - right.ordinal,
    )
    .map((run) => ({
      run,
      messageId: run.userMessageId,
      text:
        projection.messages.find((message) => message.id === run.userMessageId)?.text ??
        "Queued message",
    }));
  return {
    activeRun: projection.runs.findLast((run) => ACTIVE_RUN_STATUSES.has(run.status)) ?? null,
    queuedRuns,
    isHeld: queuedRuns.some(({ run }) => run.queueHeld === true),
  };
}

/**
 * The interrupted run **Resume** continues: the thread's latest run that
 * ran, when it was interrupted (T3 Code's `resumableRunId`
 * in `ChatView.tsx`, without usage limits).
 */
export function resolveResumableRunId(
  projection: Pick<OrchestrationV2ThreadProjection, "runs">,
): OrchestrationV2Run["id"] | null {
  const latest = latestExecutedRun(projection.runs);
  return latest?.status === "interrupted" ? latest.id : null;
}

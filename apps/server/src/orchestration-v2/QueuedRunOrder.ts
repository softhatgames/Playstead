import type { OrchestrationV2Run } from "@playstead/contracts/orchestrationV2";

/**
 * Queued runs in the order they start (T3 Code's `queuedRunsInDeliveryOrder`,
 * `apps/server/src/orchestration-v2/QueuedRunOrder.ts` at 2577baf, without
 * the delegated completions Playstead does not have): by queue position,
 * then by ordinal.
 */
export const queuedRunsInDeliveryOrder = (
  runs: ReadonlyArray<OrchestrationV2Run>,
): ReadonlyArray<OrchestrationV2Run> =>
  runs
    .filter((run) => run.status === "queued")
    .toSorted(
      (left, right) =>
        (left.queuePosition ?? left.ordinal) - (right.queuePosition ?? right.ordinal) ||
        left.ordinal - right.ordinal,
    );

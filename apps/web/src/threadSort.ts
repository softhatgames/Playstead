import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

/**
 * Threads newest first (T3 Code's `sortThreads` and `getThreadSortTimestamp`
 * in `packages/client-runtime/src/state/threadSort.ts` at 2577baf), by the
 * latest message sent (`updated_at`) or by creation (`created_at`). The
 * shell has no latest-message time; the latest run's request stands for it,
 * as each message asks for a run, and a thread without one falls back to
 * `updatedAt`. Ties go to the larger id.
 */

export type ThreadSortOrder = "updated_at" | "created_at";

export type ThreadSortInput = Pick<
  OrchestrationV2ThreadShell,
  "id" | "createdAt" | "updatedAt" | "latestRunRequestedAt"
>;

const timeOf = (iso: string | null) => (iso === null ? 0 : Date.parse(iso) || 0);

export function threadSortTimestamp(thread: ThreadSortInput, order: ThreadSortOrder): number {
  return order === "created_at"
    ? timeOf(thread.createdAt)
    : timeOf(thread.latestRunRequestedAt) || timeOf(thread.updatedAt);
}

export function sortThreads<T extends ThreadSortInput>(
  threads: ReadonlyArray<T>,
  order: ThreadSortOrder,
): T[] {
  return threads.toSorted(
    (left, right) =>
      threadSortTimestamp(right, order) - threadSortTimestamp(left, order) ||
      right.id.localeCompare(left.id),
  );
}

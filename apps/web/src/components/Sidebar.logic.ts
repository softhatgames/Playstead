import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2ThreadShell,
} from "@playstead/contracts/orchestrationV2";

/**
 * Whether the thread shows the unseen-completion dot (T3 Code's
 * `hasUnseenCompletion` in `apps/web/src/components/Sidebar.logic.ts` at
 * 2577baf): its latest run completed after the thread was last visited. A
 * thread never visited shows none. The server's read marker is the only
 * one; T3 Code's browser-local fallback is for servers without it.
 */
export function hasUnseenCompletion(
  thread: Pick<OrchestrationV2ThreadShell, "latestRunCompletedAt" | "lastVisitedAt">,
): boolean {
  if (thread.latestRunCompletedAt === null || thread.lastVisitedAt === null) return false;
  const completedAt = Date.parse(thread.latestRunCompletedAt);
  if (Number.isNaN(completedAt)) return false;
  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

/**
 * A double-click sends two clicks before `dblclick`, the second with
 * `detail` 2; that one must not run a row's single-click navigation, or
 * double-click-to-rename would navigate too (T3 Code's
 * `isTrailingDoubleClick`). Keyboard activations have `detail` 0.
 */
export function isTrailingDoubleClick(detail: number): boolean {
  return detail > 1;
}

/** The status a thread row shows before its title (T3 Code's thread status pill, Playstead's two). */
export type ThreadStatusLabel = "Working" | "Completed";

/** T3 Code's `THREAD_STATUS_PRIORITY` for the statuses Playstead shows. */
const THREAD_STATUS_PRIORITY: Record<ThreadStatusLabel, number> = { Working: 4, Completed: 1 };

/** The thread's row status: working while its run is, else an unseen completion. */
export function threadStatusLabel(
  thread: Pick<OrchestrationV2ThreadShell, "status" | "latestRunCompletedAt" | "lastVisitedAt">,
): ThreadStatusLabel | null {
  if (thread.status !== "idle" && ACTIVE_RUN_STATUSES.has(thread.status)) return "Working";
  return hasUnseenCompletion(thread) ? "Completed" : null;
}

/**
 * What a folded project, or the threads behind **Show more**, show in the
 * tree: the most pressing status of the threads (T3 Code's
 * `resolveProjectStatusIndicator`).
 */
export function resolveProjectStatusIndicator(
  threads: ReadonlyArray<
    Pick<OrchestrationV2ThreadShell, "status" | "latestRunCompletedAt" | "lastVisitedAt">
  >,
): ThreadStatusLabel | null {
  let highest: ThreadStatusLabel | null = null;
  for (const thread of threads) {
    const status = threadStatusLabel(thread);
    if (status === null) continue;
    if (highest === null || THREAD_STATUS_PRIORITY[status] > THREAD_STATUS_PRIORITY[highest]) {
      highest = status;
    }
  }
  return highest;
}

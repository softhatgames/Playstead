import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

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

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

const timeOf = (iso: string | null): number => (iso === null ? 0 : Date.parse(iso) || 0);

/**
 * The project tree's projects in the chosen order (T3 Code's
 * `sortProjectsForSidebar` over `orderItemsByPreferredIds` in
 * `LegacySidebar.tsx`): newest first by their threads' latest message
 * (`updated_at`) or creation (`created_at`), a project without threads by
 * its own time; or `manual`, the person's `projectOrder` (from the ui
 * state), projects it does not name after it in the server's order. Ties
 * go by title.
 */
export function sortTreeProjects<
  P extends {
    readonly id: string;
    readonly title: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  },
>(input: {
  readonly projects: ReadonlyArray<P>;
  readonly threads: ReadonlyArray<
    Pick<
      OrchestrationV2ThreadShell,
      "createdAt" | "updatedAt" | "latestRunRequestedAt" | "archivedAt"
    > & { readonly projectId: string }
  >;
  readonly sortOrder: "updated_at" | "created_at" | "manual";
  readonly projectOrder: ReadonlyArray<string>;
}): P[] {
  if (input.sortOrder === "manual") {
    const rank = new Map(input.projectOrder.map((id, index) => [id, index]));
    const ranked = input.projects.filter((project) => rank.has(project.id));
    ranked.sort((left, right) => rank.get(left.id)! - rank.get(right.id)!);
    return [...ranked, ...input.projects.filter((project) => !rank.has(project.id))];
  }
  const latest = new Map<string, number>();
  for (const thread of input.threads) {
    if (thread.archivedAt !== null) continue;
    const time =
      input.sortOrder === "created_at"
        ? timeOf(thread.createdAt)
        : timeOf(thread.latestRunRequestedAt) || timeOf(thread.updatedAt);
    latest.set(thread.projectId, Math.max(latest.get(thread.projectId) ?? 0, time));
  }
  const timeOfProject = (project: P) =>
    latest.get(project.id) ??
    timeOf(input.sortOrder === "created_at" ? project.createdAt : project.updatedAt);
  return input.projects.toSorted(
    (left, right) =>
      timeOfProject(right) - timeOfProject(left) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
}

/**
 * The project order after dragging `draggedId` onto `targetId` (T3 Code's
 * `reorderProjects` in `uiStateStore.ts`): the dragged project takes the
 * target's place, the target moving aside toward where the dragged one
 * came from. The same order when either is missing or they are the same.
 */
export function reorderProjects(
  order: ReadonlyArray<string>,
  draggedId: string,
  targetId: string,
): ReadonlyArray<string> {
  const from = order.indexOf(draggedId);
  const to = order.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return order;
  const next = order.filter((id) => id !== draggedId);
  next.splice(to, 0, draggedId);
  return next;
}

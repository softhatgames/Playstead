/**
 * Moving between threads and starting new ones from the keyboard (T3 Code's
 * `apps/web/src/components/Sidebar.logic.ts`, `LegacySidebar.tsx` and
 * `lib/chatThreadActions.ts` at 2577baf).
 */

/**
 * The thread `mod+shift+[` or `]` goes to in the sidebar's order: the one
 * above or below, nothing past either end, and from no thread the last or
 * the first (T3 Code's `resolveAdjacentThreadId`).
 */
export function resolveAdjacentThreadId<T>(input: {
  readonly threadIds: ReadonlyArray<T>;
  readonly currentThreadId: T | null;
  readonly direction: "previous" | "next";
}): T | null {
  const { currentThreadId, direction, threadIds } = input;
  if (threadIds.length === 0) return null;
  if (currentThreadId === null) {
    return direction === "previous" ? (threadIds.at(-1) ?? null) : (threadIds[0] ?? null);
  }
  const index = threadIds.indexOf(currentThreadId);
  if (index === -1) return null;
  return (direction === "previous" ? threadIds[index - 1] : threadIds[index + 1]) ?? null;
}

/**
 * Whether **New thread** starts in the current project at once rather than
 * opening **New thread in…**: with Shift held, or one project group or none.
 */
export function shouldCreateNewThreadInCurrentProject(
  shiftKey: boolean,
  projectGroupCount: number,
): boolean {
  return shiftKey || projectGroupCount <= 1;
}

/**
 * The project a new thread starts in: the thread in view's, the draft in
 * view's, the project last opened, or the first, skipping any that is gone
 * or outside the sidebar's scope (T3 Code's `resolveThreadActionProjectRef`,
 * with Playstead's last opened project and the inbox's scope).
 */
export function resolveNewThreadProjectId(input: {
  readonly threadProjectId?: string | undefined;
  readonly draftProjectId?: string | undefined;
  readonly openedProjectId?: string | undefined;
  /** Every project, in the sidebar's order. */
  readonly projectIds: ReadonlyArray<string>;
  /** The scope's projects, or none to allow every project. */
  readonly scopedProjectIds?: ReadonlySet<string> | null;
}): string | undefined {
  const allowed = (projectId: string | undefined): projectId is string =>
    projectId !== undefined &&
    input.projectIds.includes(projectId) &&
    (input.scopedProjectIds == null || input.scopedProjectIds.has(projectId));
  return [
    input.threadProjectId,
    input.draftProjectId,
    input.openedProjectId,
    ...input.projectIds,
  ].find(allowed);
}

/**
 * The tree's threads as shown, top to bottom, for the previous, next and
 * jump shortcuts: each project's first `previewCount` until **Show more**,
 * plus the thread in view when it is folded away (T3 Code's
 * `visibleSidebarThreadKeys`).
 */
export function visibleTreeThreads<T extends { readonly id: string }>(input: {
  readonly projects: ReadonlyArray<{ readonly id: string }>;
  /** Each project's threads, already in the tree's order. */
  readonly threadsByProject: ReadonlyMap<string, ReadonlyArray<T>>;
  readonly previewCount: number;
  readonly expandedProjectIds: ReadonlySet<string>;
  readonly activeThreadId: string | undefined;
}): T[] {
  return input.projects.flatMap((project) => {
    const threads = input.threadsByProject.get(project.id) ?? [];
    if (input.expandedProjectIds.has(project.id) || threads.length <= input.previewCount) {
      return [...threads];
    }
    const shown = threads.slice(0, input.previewCount);
    const current = threads
      .slice(input.previewCount)
      .find((thread) => thread.id === input.activeThreadId);
    return current === undefined ? shown : [...shown, current];
  });
}

/** How long the jump modifier is held before the rows show their keys. */
export const THREAD_JUMP_HINT_SHOW_DELAY_MS = 200;

export interface ThreadJumpHintVisibilityController {
  readonly sync: (shouldShow: boolean) => void;
  readonly dispose: () => void;
}

/**
 * Shows the jump hints once the modifier has been held for the delay and
 * hides them as soon as it is let go (T3 Code's
 * `createThreadJumpHintVisibilityController`).
 */
export function createThreadJumpHintVisibilityController<Id>(input: {
  readonly delayMs: number;
  readonly onVisibilityChange: (visible: boolean) => void;
  readonly setTimeoutFn: (callback: () => void, delayMs: number) => Id;
  readonly clearTimeoutFn: (id: Id) => void;
}): ThreadJumpHintVisibilityController {
  let visible = false;
  let pending: { readonly id: Id } | null = null;
  const cancel = () => {
    if (pending === null) return;
    input.clearTimeoutFn(pending.id);
    pending = null;
  };
  return {
    sync: (shouldShow) => {
      if (!shouldShow) {
        cancel();
        if (visible) {
          visible = false;
          input.onVisibilityChange(false);
        }
        return;
      }
      if (visible || pending !== null) return;
      pending = {
        id: input.setTimeoutFn(() => {
          pending = null;
          visible = true;
          input.onVisibilityChange(true);
        }, input.delayMs),
      };
    },
    dispose: cancel,
  };
}

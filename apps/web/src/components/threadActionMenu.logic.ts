import type { ThreadId } from "@playstead/contracts/baseSchemas";
import type { ContextMenuItem } from "@playstead/contracts/ipc";
import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2ThreadShell,
} from "@playstead/contracts/orchestrationV2";

/**
 * The thread menu (T3 Code's `apps/web/src/components/threadActionMenu.logic.ts`
 * at 2577baf), opened from a sidebar row and the thread view's header. It
 * has T3 Code's items in T3 Code's order as each arrives: **Rename thread**,
 * **Mark unread**, **Archive thread** and **Delete**. Pin, settle, snooze,
 * regenerate title, filter by project, auto-settle and copy come with their
 * features, as fields of the state and ids here.
 */
export type ThreadActionMenuId = "rename" | "mark-unread" | "archive" | "delete";

export interface ThreadActionMenuState {
  /** Archive is disabled while the thread's run works, rather than let it stop the run. */
  readonly isRunning: boolean;
}

export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  return [
    { id: "rename", label: "Rename thread", separatorBefore: true },
    { id: "mark-unread", label: "Mark unread" },
    {
      id: "archive",
      label: "Archive thread",
      disabled: state.isRunning,
      separatorBefore: true,
    },
    { id: "delete", label: "Delete", destructive: true },
  ];
}

/**
 * Whether the thread can be archived now (T3 Code's `threadRuntimeCanArchive`,
 * `packages/client-runtime/src/state/models.ts`). Playstead has no checkpoint
 * wait: all of its active statuses keep Archive disabled, including waiting.
 */
export const threadRuntimeCanArchive = (status: OrchestrationV2ThreadShell["status"]): boolean =>
  status === "idle" || !ACTIVE_RUN_STATUSES.has(status);

export type ArchivedThreadMenuId = "unarchive" | "delete";

/** An archived thread's menu in **Settings → Archive** (T3 Code's `ArchivedThreadsPanel`). */
export const archivedThreadMenuItems: ReadonlyArray<ContextMenuItem<ArchivedThreadMenuId>> = [
  { id: "unarchive", label: "Unarchive" },
  { id: "delete", label: "Delete", destructive: true },
];

/** Asked before archiving when **Confirm before archiving** is on (T3 Code's words). */
export const threadArchiveConfirmation = (title: string) => `Archive thread "${title}"?`;

/** Asked before deleting when **Confirm before deleting** is on (T3 Code's words). */
export const threadDeleteConfirmation = (title: string) =>
  [
    `Delete thread "${title}"?`,
    "This permanently clears conversation history for this thread.",
  ].join("\n");

/**
 * Where the view goes after its thread is deleted (T3 Code's
 * `getFallbackThreadIdAfterDelete`): the newest other thread of the same
 * project, in the sidebar's order, or nowhere.
 */
export function fallbackThreadAfterDelete(
  threads: ReadonlyArray<Pick<OrchestrationV2ThreadShell, "id" | "projectId" | "createdAt">>,
  deletedThreadId: ThreadId,
): ThreadId | null {
  const deleted = threads.find((thread) => thread.id === deletedThreadId);
  if (deleted === undefined) return null;
  return (
    threads
      .filter((thread) => thread.projectId === deleted.projectId && thread.id !== deletedThreadId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.id ?? null
  );
}

import type { ThreadId } from "@playstead/contracts/baseSchemas";
import type { ContextMenuItem } from "@playstead/contracts/ipc";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import type { SnoozePreset } from "@playstead/client-runtime/state/threadSettled";

import { type SnoozeMenuId, snoozeMenuChildren } from "./Sidebar.snooze.ts";

/**
 * The thread menu (T3 Code's `apps/web/src/components/threadActionMenu.logic.ts`
 * at 2577baf), opened from a sidebar row and the thread view's header. It
 * has T3 Code's items in T3 Code's order as each arrives: so far **Pin
 * thread**, **Settle thread**, **Snooze** (its presets and **Custom…**) or
 * **Wake thread**, **Rename thread**, **Regenerate title**, **Mark
 * unread**, **Filter by project**, **Auto-settle behavior**, **Copy** (Path
 * and Thread ID), **Project settings**, **Archive thread** and **Delete**.
 * Threads have no branch, so
 * T3 Code's "New thread on (branch)" and **Copy → Branch** never show.
 */
export type ThreadActionMenuId =
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "snooze"
  | SnoozeMenuId
  | "unsnooze"
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "filter-by-project"
  | "auto-settle"
  | "auto-settle:enabled"
  | "auto-settle:disabled"
  | "copy"
  | "copy-path"
  | "copy-thread-id"
  | "project-settings"
  | "archive"
  | "delete";

export interface ThreadActionMenuState {
  /** Archive is disabled while the thread's run works, rather than let it stop the run. */
  readonly isRunning: boolean;
  /** A title is being generated: **Regenerate title** reads "Regenerating…" and is disabled. */
  readonly isRegeneratingTitle: boolean;
  /**
   * The sidebar's filter to the thread's project, offered from a sidebar row
   * only (T3 Code's header menu passes none): the project's name, and
   * whether the sidebar is already filtered to it.
   */
  readonly projectFilter: { readonly label: string; readonly isActive: boolean } | null;
  readonly isPinned: boolean;
  readonly isSettled: boolean;
  /** Snoozed now: the menu offers **Wake thread** instead of **Snooze**. */
  readonly isSnoozed: boolean;
  /** False while the thread waits on the person or about to start: **Snooze** is disabled. */
  readonly canSnoozeNow: boolean;
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  /** Automatic settlement is on for the thread (T3 Code's `autoSettleEnabled`). */
  readonly autoSettleEnabled: boolean;
}

export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  return [
    state.isPinned ? { id: "unpin", label: "Unpin thread" } : { id: "pin", label: "Pin thread" },
    state.isSettled
      ? { id: "unsettle", label: "Un-settle thread" }
      : { id: "settle", label: "Settle thread" },
    state.isSnoozed
      ? { id: "unsnooze", label: "Wake thread" }
      : {
          id: "snooze",
          label: "Snooze",
          disabled: !state.canSnoozeNow,
          children: snoozeMenuChildren(state.snoozePresets),
        },
    { id: "rename", label: "Rename thread", separatorBefore: true },
    {
      id: "regenerate-title",
      label: state.isRegeneratingTitle ? "Regenerating…" : "Regenerate title",
      disabled: state.isRegeneratingTitle,
    },
    { id: "mark-unread", label: "Mark unread" },
    ...(state.projectFilter === null
      ? []
      : [
          {
            id: "filter-by-project" as const,
            label: state.projectFilter.isActive
              ? "Show all projects"
              : `Filter by ${state.projectFilter.label}`,
          },
        ]),
    {
      id: "auto-settle",
      label: "Auto-settle behavior",
      children: [
        { id: "auto-settle:enabled", label: "Enabled", checked: state.autoSettleEnabled },
        { id: "auto-settle:disabled", label: "Disabled", checked: !state.autoSettleEnabled },
      ],
    },
    {
      id: "copy",
      label: "Copy",
      separatorBefore: true,
      children: [
        { id: "copy-path", label: "Path" },
        { id: "copy-thread-id", label: "Thread ID" },
      ],
    },
    { id: "project-settings", label: "Project settings" },
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
 * `packages/client-runtime/src/state/models.ts`): not while its run is
 * starting or running. A run waiting on the person may be archived.
 */
export const threadRuntimeCanArchive = (status: OrchestrationV2ThreadShell["status"]): boolean =>
  status !== "starting" && status !== "running";

export type LegacyThreadMenuId =
  | "rename"
  | "mark-unread"
  | "copy-path"
  | "copy-thread-id"
  | "project-settings"
  | "delete";

/**
 * A thread's menu in the project tree (**Sidebar (legacy)**), flat as T3
 * Code's `LegacySidebar.tsx` builds it; archiving is the row's hover button
 * there.
 */
export const legacyThreadMenuItems: ReadonlyArray<ContextMenuItem<LegacyThreadMenuId>> = [
  { id: "rename", label: "Rename thread" },
  { id: "mark-unread", label: "Mark unread" },
  { id: "copy-path", label: "Copy Path" },
  { id: "copy-thread-id", label: "Copy Thread ID" },
  { id: "project-settings", label: "Project settings" },
  { id: "delete", label: "Delete", destructive: true },
];

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

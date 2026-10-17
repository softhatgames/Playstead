import type { ContextMenuPosition } from "@playstead/contracts/ipc";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { copyTextToClipboard } from "../clipboard.ts";
import { readClientSettings } from "../clientSettings.ts";
import { buildSidebarProjectGroups } from "../components/Sidebar.inbox.logic.ts";
import {
  buildThreadActionMenuItems,
  legacyThreadMenuItems,
  threadArchiveConfirmation,
  threadRuntimeCanArchive,
} from "../components/threadActionMenu.logic.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { readLocalApi } from "../localApi.ts";
import { settleAndAdvance } from "../settleAndAdvance.ts";
import { failureToast, successToast } from "../toast.ts";
import { readSidebarProjectScopeKey, setSidebarProjectScopeKey } from "../uiState.ts";
import {
  markThreadUnread,
  pinThread,
  regenerateThreadTitle,
  settleThread,
  type ThreadLifecycleTarget,
  unpinThread,
  unsettleThread,
  useThreadActions,
} from "./useThreadActions.ts";

/**
 * Opens a thread's menu and runs what is chosen (T3 Code's
 * `apps/web/src/hooks/useThreadActionMenu.ts` at 2577baf, with the inbox
 * sidebar row's handling from `apps/web/src/components/Sidebar.tsx` and the
 * project tree's flat menu from `LegacySidebar.tsx`). The inbox sidebar's
 * rows and the thread view's header open the full menu; the project tree's
 * rows open its own (`variant: "tree"`).
 *
 * - **Pin thread** / **Unpin thread**, with Undo after unpinning.
 * - **Settle thread** / **Un-settle thread**; settling the thread in view
 *   moves the view on, through the inbox sidebar when it is shown, and
 *   shows Undo. A refusal, such as a thread still working, is a notice.
 * - **Rename thread** starts the caller's inline rename (`onStartRename`).
 * - **Regenerate title** has a provider write a new title; while one is
 *   being written it reads "Regenerating…" and does nothing.
 * - **Mark unread** shows the thread as unread; T3 Code reports no failure,
 *   such as a thread with no completed run.
 * - **Filter by project**, offered when `projectFilter` is on (the inbox
 *   sidebar row), scopes the sidebar to the thread's project, or to every
 *   project again when it already is.
 * - **Copy → Path** copies the project's folder, and **Copy → Thread ID**
 *   the thread's id, each with a notice.
 * - **Project settings** opens the thread's project's settings.
 * - Archiving asks first when **Confirm before archiving** is on, deleting
 *   when **Confirm before deleting** is; a failure shows as a notice.
 */
export function useThreadActionMenu(
  thread: ThreadLifecycleTarget | null,
  options: {
    readonly onStartRename: () => void;
    readonly projectFilter?: boolean;
    readonly variant?: "full" | "tree";
  },
) {
  const { onStartRename, projectFilter = false, variant = "full" } = options;
  const { archiveThread, confirmAndDeleteThread } = useThreadActions();
  const shell = usePrimaryConnectionState()?.shell;
  const navigate = useNavigate();

  const openMenu = useCallback(
    (position: ContextMenuPosition) => {
      if (thread === null) return;
      const project = shell?.projects.find((candidate) => candidate.id === thread.projectId);
      const group =
        projectFilter && shell !== undefined
          ? buildSidebarProjectGroups({
              projects: shell.projects,
              threads: shell.threads,
              sortOrder: "manual",
            }).find((candidate) => candidate.projectIds.includes(thread.projectId))
          : undefined;
      void (async () => {
        const api = readLocalApi();
        const isRegeneratingTitle = thread.titleRegeneration !== null;
        const items =
          variant === "tree"
            ? legacyThreadMenuItems
            : buildThreadActionMenuItems({
                isRunning: !threadRuntimeCanArchive(thread.status),
                isRegeneratingTitle,
                isPinned: thread.pinnedAt !== null,
                isSettled: thread.settledOverride === "settled",
                projectFilter:
                  group === undefined
                    ? null
                    : {
                        label: group.displayName,
                        isActive: readSidebarProjectScopeKey() === group.key,
                      },
              });
        const chosen = await api.contextMenu.show(items, position).catch(() => null);
        switch (chosen) {
          case "pin":
            await pinThread(thread.id).catch((error: unknown) =>
              failureToast("Failed to pin thread", error),
            );
            return;
          case "unpin":
            await unpinThread(thread).catch((error: unknown) =>
              failureToast("Failed to unpin thread", error),
            );
            return;
          case "settle":
            if (settleAndAdvance(thread)) return;
            await settleThread(thread).catch((error: unknown) =>
              failureToast("Failed to settle thread", error),
            );
            return;
          case "unsettle":
            await unsettleThread(thread.id).catch((error: unknown) =>
              failureToast("Failed to un-settle thread", error),
            );
            return;
          case "rename":
            onStartRename();
            return;
          case "regenerate-title":
            if (isRegeneratingTitle) return;
            await regenerateThreadTitle(thread.id).catch((error: unknown) =>
              failureToast("Failed to regenerate thread title", error),
            );
            return;
          case "mark-unread":
            await markThreadUnread(thread.id).catch(() => undefined);
            return;
          case "filter-by-project":
            if (group !== undefined) {
              setSidebarProjectScopeKey(
                readSidebarProjectScopeKey() === group.key ? null : group.key,
              );
            }
            return;
          case "copy-path": {
            if (project === undefined) {
              failureToast(
                "Path unavailable",
                new Error("This thread does not have a workspace path to copy."),
              );
              return;
            }
            await copyTextToClipboard(project.workspaceRoot).then(
              () => successToast("Path copied", project.workspaceRoot),
              (error: unknown) => failureToast("Failed to copy path", error),
            );
            return;
          }
          case "copy-thread-id":
            await copyTextToClipboard(thread.id).then(
              () => successToast("Thread ID copied", thread.id),
              (error: unknown) => failureToast("Failed to copy thread ID", error),
            );
            return;
          case "project-settings":
            await navigate({
              to: "/projects/$projectKey",
              params: { projectKey: thread.projectId },
            });
            return;
          case "archive": {
            const settings = await readClientSettings();
            if (
              settings.confirmThreadArchive &&
              !(await api.dialogs.confirm(threadArchiveConfirmation(thread.title)))
            ) {
              return;
            }
            await archiveThread(thread).catch((error: unknown) =>
              failureToast("Failed to archive thread", error),
            );
            return;
          }
          case "delete":
            await confirmAndDeleteThread(thread).catch((error: unknown) =>
              failureToast("Failed to delete thread", error),
            );
            return;
          case "copy":
          case null:
            return;
        }
      })();
    },
    [
      archiveThread,
      confirmAndDeleteThread,
      navigate,
      onStartRename,
      projectFilter,
      shell,
      thread,
      variant,
    ],
  );

  const closeMenu = useCallback(() => {
    readLocalApi().contextMenu.close();
  }, []);

  return { openMenu, closeMenu };
}

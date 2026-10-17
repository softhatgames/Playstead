import type { ContextMenuPosition } from "@playstead/contracts/ipc";
import { useCallback } from "react";

import { copyTextToClipboard } from "../clipboard.ts";
import { readClientSettings } from "../clientSettings.ts";
import {
  buildThreadActionMenuItems,
  threadArchiveConfirmation,
  threadRuntimeCanArchive,
} from "../components/threadActionMenu.logic.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { readLocalApi } from "../localApi.ts";
import { failureToast, successToast } from "../toast.ts";
import { readSidebarProjectFilter, setSidebarProjectFilter } from "../uiState.ts";
import {
  markThreadUnread,
  regenerateThreadTitle,
  type ThreadActionTarget,
  useThreadActions,
} from "./useThreadActions.ts";

/**
 * Opens a thread's menu and runs what is chosen (T3 Code's
 * `apps/web/src/hooks/useThreadActionMenu.ts` at 2577baf, with the sidebar
 * row's **Filter by project** from `apps/web/src/components/Sidebar.tsx`).
 * The sidebar row and the thread view's header share it.
 *
 * - **Rename thread** starts the caller's inline rename (`onStartRename`).
 * - **Regenerate title** has a provider write a new title; while one is
 *   being written it reads "Regenerating…" and does nothing.
 * - **Mark unread** shows the thread as unread; T3 Code reports no failure,
 *   such as a thread with no completed run.
 * - **Filter by project**, offered when `projectFilter` is on (the sidebar
 *   row), shows only the thread's project in the sidebar, or every project
 *   again when it already does.
 * - **Copy → Path** copies the project's folder, and **Copy → Thread ID**
 *   the thread's id, each with a notice.
 * - Archiving asks first when **Confirm before archiving** is on, deleting
 *   when **Confirm before deleting** is; a failure shows as a notice.
 */
export function useThreadActionMenu(
  thread: ThreadActionTarget | null,
  options: { readonly onStartRename: () => void; readonly projectFilter?: boolean },
) {
  const { onStartRename, projectFilter = false } = options;
  const { archiveThread, confirmAndDeleteThread } = useThreadActions();
  const projects = usePrimaryConnectionState()?.shell?.projects;

  const openMenu = useCallback(
    (position: ContextMenuPosition) => {
      if (thread === null) return;
      const project = projects?.find((candidate) => candidate.id === thread.projectId);
      void (async () => {
        const api = readLocalApi();
        const isRegeneratingTitle = thread.titleRegeneration !== null;
        const items = buildThreadActionMenuItems({
          isRunning: !threadRuntimeCanArchive(thread.status),
          isRegeneratingTitle,
          projectFilter:
            projectFilter && project !== undefined
              ? { label: project.title, isActive: readSidebarProjectFilter() === project.id }
              : null,
        });
        const chosen = await api.contextMenu.show(items, position).catch(() => null);
        switch (chosen) {
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
            setSidebarProjectFilter(
              readSidebarProjectFilter() === thread.projectId ? null : thread.projectId,
            );
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
    [archiveThread, confirmAndDeleteThread, onStartRename, projectFilter, projects, thread],
  );

  const closeMenu = useCallback(() => {
    readLocalApi().contextMenu.close();
  }, []);

  return { openMenu, closeMenu };
}

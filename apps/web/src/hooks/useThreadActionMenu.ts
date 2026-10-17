import type { ContextMenuPosition } from "@playstead/contracts/ipc";
import { useCallback } from "react";

import { readClientSettings } from "../clientSettings.ts";
import {
  buildThreadActionMenuItems,
  threadArchiveConfirmation,
  threadRuntimeCanArchive,
} from "../components/threadActionMenu.logic.ts";
import { readLocalApi } from "../localApi.ts";
import { failureToast } from "../toast.ts";
import { markThreadUnread, type ThreadActionTarget, useThreadActions } from "./useThreadActions.ts";

/**
 * Opens a thread's menu and runs what is chosen (T3 Code's
 * `apps/web/src/hooks/useThreadActionMenu.ts` at 2577baf). The sidebar row
 * and the thread view's header share it. Archiving asks first when
 * **Confirm before archiving** is on, deleting when **Confirm before
 * deleting** is; a failure shows as a notice.
 */
export function useThreadActionMenu(
  thread: ThreadActionTarget | null,
  options: { readonly onStartRename: () => void },
) {
  const { onStartRename } = options;
  const { archiveThread, confirmAndDeleteThread } = useThreadActions();

  const openMenu = useCallback(
    (position: ContextMenuPosition) => {
      if (thread === null) return;
      void (async () => {
        const api = readLocalApi();
        const items = buildThreadActionMenuItems({
          isRunning: !threadRuntimeCanArchive(thread.status),
        });
        const chosen = await api.contextMenu.show(items, position).catch(() => null);
        switch (chosen) {
          case "rename":
            onStartRename();
            return;
          case "mark-unread":
            await markThreadUnread(thread.id).catch(() => undefined);
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
          case null:
            return;
        }
      })();
    },
    [archiveThread, confirmAndDeleteThread, onStartRename, thread],
  );

  const closeMenu = useCallback(() => readLocalApi().contextMenu.close(), []);
  return { openMenu, closeMenu };
}

import { CommandId, type ThreadId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { readClientSettings } from "../clientSettings.ts";
import {
  fallbackThreadAfterDelete,
  threadDeleteConfirmation,
  threadRuntimeCanArchive,
} from "../components/threadActionMenu.logic.ts";
import { requestPrimary, usePrimaryConnectionState } from "../connection/runtime.ts";
import { createDraft } from "../drafts.ts";
import { newId } from "../ids.ts";
import { readLocalApi } from "../localApi.ts";

/** The thread an action is for: from the sidebar's shell, the archive, or the thread view. */
export type ThreadActionTarget = Pick<
  OrchestrationV2ThreadShell,
  "id" | "projectId" | "title" | "status"
>;

const dispatchThreadCommand = (
  type: "thread.archive" | "thread.unarchive" | "thread.delete",
  threadId: ThreadId,
) =>
  requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      type,
      commandId: CommandId.make(`command:${newId()}`),
      threadId,
    }),
  );

/**
 * What the interface does to a thread (T3 Code's
 * `apps/web/src/hooks/useThreadActions.ts` at 2577baf): each action sends its
 * command and, when the thread is the one in view, moves the view away. An
 * archived thread in view gives way to a new draft in its project; a
 * deleted one to the newest other thread of its project, or the start page.
 * A failure rejects, for the caller to show.
 */
export function useThreadActions() {
  const navigate = useNavigate();
  const { threadId: routeThreadId } = useParams({ strict: false });
  const threads = usePrimaryConnectionState()?.shell?.threads;

  const archiveThread = useCallback(
    async (thread: ThreadActionTarget) => {
      if (!threadRuntimeCanArchive(thread.status)) {
        throw new Error("This thread is still working. Stop it before archiving it.");
      }
      await dispatchThreadCommand("thread.archive", thread.id);
      if (routeThreadId === thread.id) {
        await navigate({
          to: "/draft/$draftId",
          params: { draftId: createDraft(thread.projectId) },
        });
      }
    },
    [navigate, routeThreadId],
  );

  const unarchiveThread = useCallback(async (threadId: ThreadId) => {
    await dispatchThreadCommand("thread.unarchive", threadId);
  }, []);

  const deleteThread = useCallback(
    async (thread: ThreadActionTarget) => {
      const fallback = fallbackThreadAfterDelete(threads ?? [], thread.id);
      await dispatchThreadCommand("thread.delete", thread.id);
      if (routeThreadId !== thread.id) return;
      await (fallback === null
        ? navigate({ to: "/", replace: true })
        : navigate({ to: "/threads/$threadId", params: { threadId: fallback }, replace: true }));
    },
    [navigate, routeThreadId, threads],
  );

  /** Deletes after asking, when **Confirm before deleting** is on; false if the person declined. */
  const confirmAndDeleteThread = useCallback(
    async (thread: ThreadActionTarget) => {
      const settings = await readClientSettings();
      if (settings.confirmThreadDelete) {
        const confirmed = await readLocalApi().dialogs.confirm(
          threadDeleteConfirmation(thread.title),
          { variant: "destructive" },
        );
        if (!confirmed) return false;
      }
      await deleteThread(thread);
      return true;
    },
    [deleteThread],
  );

  return useMemo(
    () => ({ archiveThread, unarchiveThread, deleteThread, confirmAndDeleteThread }),
    [archiveThread, unarchiveThread, deleteThread, confirmAndDeleteThread],
  );
}

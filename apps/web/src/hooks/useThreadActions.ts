import { canSnooze } from "@playstead/client-runtime/state/threadSettled";
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
import { showThreadUndoNotice } from "./showThreadUndoNotice.ts";
import * as ThreadUndo from "./threadUndo.ts";

/** The thread an action is for: from the sidebar's shell, the archive, or the thread view. */
export type ThreadActionTarget = Pick<
  OrchestrationV2ThreadShell,
  "id" | "projectId" | "title" | "status" | "titleRegeneration"
>;

/** A thread the sidebar or the thread view shows, which can be pinned, settled and snoozed. */
export type ThreadLifecycleTarget = ThreadActionTarget &
  Pick<
    OrchestrationV2ThreadShell,
    | "pinnedAt"
    | "pinOrderKey"
    | "settledOverride"
    | "autoSettleDisabledAt"
    | "snoozedUntil"
    | "snoozedAt"
    | "latestRunCompletedAt"
    | "hasPendingUserInput"
  >;

const commandId = () => CommandId.make(`command:${newId()}`);

const dispatchThreadCommand = (
  type:
    | "thread.archive"
    | "thread.unarchive"
    | "thread.delete"
    | "thread.mark-unread"
    | "thread.unpin"
    | "thread.settle",
  threadId: ThreadId,
) =>
  requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({ type, commandId: commandId(), threadId }),
  );

/** Gives the thread a title the person chose (T3 Code's `thread.metadata.update {title}`). */
export const renameThread = (threadId: ThreadId, title: string) =>
  requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      type: "thread.metadata.update",
      commandId: commandId(),
      threadId,
      title,
    }),
  );

/**
 * Has the **Text generation** provider write the thread a new title from its
 * conversation (T3 Code's `thread.metadata.update {regenerateTitle: true}`).
 */
export const regenerateThreadTitle = (threadId: ThreadId) =>
  requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      type: "thread.metadata.update",
      commandId: CommandId.make(`command:${newId()}`),
      threadId,
      regenerateTitle: true,
    }),
  );

/** Moves the thread's read marker to `visitedAt`, when the thread view shows it. */
export const visitThread = (threadId: ThreadId, visitedAt: string) =>
  requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      type: "thread.visit",
      commandId: commandId(),
      threadId,
      visitedAt,
    }),
  );

/** Shows the thread as unread again, until it is next viewed (T3 Code's `markThreadUnread`). */
export const markThreadUnread = (threadId: ThreadId) =>
  dispatchThreadCommand("thread.mark-unread", threadId);

/**
 * Turns automatic settlement on or off for the thread (T3 Code's
 * `setThreadAutoSettle`, `thread.auto-settle.set`).
 */
export const setThreadAutoSettle = (threadId: ThreadId, enabled: boolean) =>
  requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      type: "thread.auto-settle.set",
      commandId: commandId(),
      threadId,
      enabled,
    }),
  );

/**
 * Pins the thread (T3 Code's `pinThread`). A pin made from the interface
 * takes no order key until #40 brings order keys, so it sorts among the
 * keyless pins; Undo of an unpin restores its old key. It takes over any
 * older unpin's Undo.
 */
export const pinThread = (threadId: ThreadId, orderKey?: string | null) => {
  ThreadUndo.invalidate("pin", threadId);
  return requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      type: "thread.pin",
      commandId: commandId(),
      threadId,
      ...(orderKey === undefined || orderKey === null ? {} : { orderKey }),
    }),
  );
};

/** Unpins the thread, with **Undo** to pin it back where it was (T3 Code's `unpinThread`). */
export async function unpinThread(
  thread: Pick<OrchestrationV2ThreadShell, "id" | "pinOrderKey">,
): Promise<void> {
  const claim = ThreadUndo.begin("pin", thread.id);
  try {
    await dispatchThreadCommand("thread.unpin", thread.id);
  } catch (error) {
    claim.finish();
    throw error;
  }
  showThreadUndoNotice({
    action: "Unpinned",
    claim,
    undo: () => pinThread(thread.id, thread.pinOrderKey),
    failureTitle: "Failed to undo unpin",
  });
}

/**
 * Brings a settled thread back to active work and holds it there (T3 Code's
 * `unsettleThread`, reason "user"); it takes over the settle's Undo.
 */
export const unsettleThread = (threadId: ThreadId) => {
  ThreadUndo.invalidate("settle", threadId);
  return requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      type: "thread.unsettle",
      commandId: commandId(),
      threadId,
      reason: "user",
    }),
  );
};

/** Wakes a snoozed thread (T3 Code's `unsnoozeThread`, reason "user"); it takes over the snooze's Undo. */
export const unsnoozeThread = (threadId: ThreadId) => {
  ThreadUndo.invalidate("snooze", threadId);
  return requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      type: "thread.unsnooze",
      commandId: commandId(),
      threadId,
      reason: "user",
    }),
  );
};

const sendSnooze = (threadId: ThreadId, snoozedUntil: string) =>
  requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      type: "thread.snooze",
      commandId: commandId(),
      threadId,
      snoozedUntil,
    }),
  );

/**
 * Snoozes the thread until `snoozedUntil`, with **Undo** that wakes it (T3
 * Code's `snoozeThread`). A thread waiting on the person, or about to start
 * its turn, is refused here as T3 Code refuses it; the server refuses a time
 * not ahead. The promise rejects with the reason.
 */
export async function snoozeThread(
  thread: Pick<OrchestrationV2ThreadShell, "id" | "status" | "hasPendingUserInput">,
  snoozedUntil: string,
): Promise<void> {
  if (!canSnooze(thread)) {
    throw new Error(
      "This thread is waiting on you. Respond to the pending request before snoozing it.",
    );
  }
  const claim = ThreadUndo.begin("snooze", thread.id);
  try {
    await sendSnooze(thread.id, snoozedUntil);
  } catch (error) {
    claim.finish();
    throw error;
  }
  showThreadUndoNotice({
    action: "Snoozed",
    claim,
    undo: () => unsnoozeThread(thread.id),
    failureTitle: "Failed to wake thread",
  });
}

/**
 * Settles the thread, with **Undo** that un-settles it, pins it back if it
 * was pinned and snoozes it again if it was snoozed (T3 Code's
 * `settleThread`). The server refuses a thread that is working or waiting
 * on the person; the promise rejects with its reason.
 */
export async function settleThread(
  thread: Pick<OrchestrationV2ThreadShell, "id" | "pinnedAt" | "pinOrderKey" | "snoozedUntil">,
): Promise<void> {
  const wasPinned = thread.pinnedAt !== null;
  const pinOrderKey = thread.pinOrderKey;
  const snoozedUntil = thread.snoozedUntil;
  // An older unpin's or snooze's Undo would re-pin or wake, which the server
  // takes as bringing the thread back; settling supersedes them.
  ThreadUndo.invalidate("pin", thread.id);
  ThreadUndo.invalidate("snooze", thread.id);
  const claim = ThreadUndo.begin("settle", thread.id);
  try {
    await dispatchThreadCommand("thread.settle", thread.id);
  } catch (error) {
    claim.finish();
    throw error;
  }
  showThreadUndoNotice({
    action: "Settled",
    claim,
    undo: async () => {
      await unsettleThread(thread.id);
      if (wasPinned) await pinThread(thread.id, pinOrderKey);
      if (snoozedUntil !== null) await sendSnooze(thread.id, snoozedUntil);
    },
    failureTitle: "Failed to undo settle",
  });
}

/**
 * What the interface does to a thread (T3 Code's
 * `apps/web/src/hooks/useThreadActions.ts` at 2577baf): each action sends its
 * command and, when the thread is the one in view, moves the view away. An
 * archived thread in view gives way to a new draft in its project, with
 * **Undo** that unarchives it and opens it again; a deleted one gives way
 * to the newest other thread of its project, or the start page. A failure
 * rejects, for the caller to show.
 */
export function useThreadActions() {
  const navigate = useNavigate();
  const { threadId: routeThreadId } = useParams({ strict: false });
  const threads = usePrimaryConnectionState()?.shell?.threads;

  const unarchiveThread = useCallback(
    async (threadId: ThreadId, options: { readonly navigate?: boolean } = {}) => {
      ThreadUndo.invalidate("archive", threadId);
      await dispatchThreadCommand("thread.unarchive", threadId);
      if (options.navigate === true) {
        await navigate({ to: "/threads/$threadId", params: { threadId } });
      }
    },
    [navigate],
  );

  const archiveThread = useCallback(
    async (thread: ThreadActionTarget) => {
      if (!threadRuntimeCanArchive(thread.status)) {
        throw new Error("This thread is still working. Stop it before archiving it.");
      }
      const viewing = routeThreadId === thread.id;
      const claim = ThreadUndo.begin("archive", thread.id);
      try {
        await dispatchThreadCommand("thread.archive", thread.id);
      } catch (error) {
        claim.finish();
        throw error;
      }
      showThreadUndoNotice({
        action: "Archived",
        claim,
        undo: () => unarchiveThread(thread.id, { navigate: viewing }),
        failureTitle: "Failed to undo archive",
      });
      if (viewing) {
        await navigate({
          to: "/draft/$draftId",
          params: { draftId: createDraft(thread.projectId) },
        });
      }
    },
    [navigate, routeThreadId, unarchiveThread],
  );

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

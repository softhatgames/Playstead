import { canSnooze, resolveSnoozePresets } from "@playstead/client-runtime/state/threadSettled";
import type { ContextMenuPosition } from "@playstead/contracts/ipc";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { useCallback } from "react";

import { readClientSettings } from "../clientSettings.ts";
import { requestCustomSnooze } from "../components/CustomSnoozeDialog.tsx";
import { buildMultiSelectThreadContextMenuItems } from "../components/Sidebar.logic.ts";
import { threadRuntimeCanArchive } from "../components/threadActionMenu.logic.ts";
import { readLocalApi } from "../localApi.ts";
import {
  clearThreadSelection,
  readThreadSelection,
  removeFromThreadSelection,
} from "../threadSelectionStore.ts";
import { failureToast } from "../components/ui/toast.tsx";
import {
  markThreadUnread,
  regenerateThreadTitle,
  confirmAndUnpinThread,
  useThreadActions,
} from "./useThreadActions.ts";

/** Asked before deleting several threads, with T3 Code's words. */
const bulkThreadDeleteConfirmation = (count: number) =>
  [
    `Delete ${count} thread${count === 1 ? "" : "s"}?`,
    "This permanently clears conversation history for these threads.",
  ].join("\n");

/**
 * The menu for the selected threads, and what it does (T3 Code's
 * `handleMultiSelectContextMenu` in `Sidebar.tsx` and `LegacySidebar.tsx` at
 * 2577baf). `threads` are the sidebar's rows in order; selected threads not
 * among them are ignored. The inbox sidebar passes `settleThreads` and
 * `snoozeThreads`, which move the view on as a row's Settle does; it offers
 * **Snooze** when every selected thread can be snoozed, and **Regenerate
 * titles** for the selected threads whose titles are not being written
 * already.
 */
export function useBulkThreadMenu(input: {
  readonly variant: "inbox" | "tree";
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly settleThreads?: (threads: ReadonlyArray<OrchestrationV2ThreadShell>) => void;
  readonly snoozeThreads?: (
    threads: ReadonlyArray<OrchestrationV2ThreadShell>,
    snoozedUntil: string,
  ) => void;
}) {
  const { variant, threads, settleThreads, snoozeThreads } = input;
  const { archiveThread, deleteThread } = useThreadActions();

  return useCallback(
    (position: ContextMenuPosition) => {
      const selected = readThreadSelection().selectedThreadIds;
      const targets = threads.filter((thread) => selected.has(thread.id));
      if (targets.length === 0) return;
      const pinned = targets.filter((thread) => thread.pinnedAt !== null);
      const settleable = targets.filter((thread) => thread.settledOverride !== "settled");
      const regeneratable = targets.filter((thread) => thread.titleRegeneration === null);
      const snoozePresets = resolveSnoozePresets(new Date());
      const snoozeable =
        variant === "inbox" && snoozeThreads !== undefined && targets.every((t) => canSnooze(t));
      void (async () => {
        const api = readLocalApi();
        const chosen = await api.contextMenu
          .show(
            buildMultiSelectThreadContextMenuItems({
              variant,
              count: targets.length,
              pinnedCount: pinned.length,
              settleableCount: settleable.length,
              hasRunningThread: targets.some((thread) => !threadRuntimeCanArchive(thread.status)),
              titleRegeneration:
                variant === "inbox"
                  ? { supportedCount: targets.length, actionableCount: regeneratable.length }
                  : null,
              snooze: snoozeable ? { presets: snoozePresets } : null,
            }),
            position,
          )
          .catch(() => null);
        if (chosen?.startsWith("snooze:") === true) {
          const choice =
            chosen === "snooze:custom"
              ? await requestCustomSnooze()
              : snoozePresets.find((preset) => `snooze:${preset.id}` === chosen);
          if (choice == null) return;
          clearThreadSelection();
          snoozeThreads?.(targets, choice.snoozedUntil);
          return;
        }
        switch (chosen) {
          case "unpin":
            clearThreadSelection();
            for (const thread of pinned) {
              confirmAndUnpinThread(thread).catch((error: unknown) =>
                failureToast("Failed to unpin thread", error),
              );
            }
            return;
          case "settle":
            clearThreadSelection();
            settleThreads?.(settleable);
            return;
          case "mark-unread":
            clearThreadSelection();
            for (const thread of targets) void markThreadUnread(thread.id).catch(() => undefined);
            return;
          case "archive": {
            // T3 Code's `archiveSelectedThreadEntries`: one at a time, stopping at a failure.
            const archived: Array<string> = [];
            for (const thread of targets) {
              try {
                await archiveThread(thread);
                archived.push(thread.id);
              } catch (error) {
                failureToast("Failed to archive thread", error);
                break;
              }
            }
            removeFromThreadSelection(archived);
            return;
          }
          case "delete": {
            const settings = await readClientSettings();
            if (
              settings.confirmThreadDelete &&
              !(await api.dialogs.confirm(bulkThreadDeleteConfirmation(targets.length), {
                variant: "destructive",
              }))
            ) {
              return;
            }
            const deleted: Array<string> = [];
            let failure: unknown = null;
            for (const thread of targets) {
              try {
                await deleteThread(thread);
                deleted.push(thread.id);
              } catch (error) {
                failure ??= error;
              }
            }
            if (failure !== null) failureToast("Failed to delete threads", failure);
            removeFromThreadSelection(deleted);
            return;
          }
          case "regenerate-title":
            // One after another, stopping at the first refusal (T3 Code's loop).
            for (const thread of regeneratable) {
              try {
                await regenerateThreadTitle(thread.id);
              } catch (error) {
                failureToast("Failed to regenerate thread titles", error);
                return;
              }
            }
            clearThreadSelection();
            return;
          case "snooze":
          case null:
          default:
            return;
        }
      })();
    },
    [archiveThread, deleteThread, settleThreads, snoozeThreads, threads, variant],
  );
}

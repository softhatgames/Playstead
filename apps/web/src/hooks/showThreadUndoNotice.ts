import { useSyncExternalStore } from "react";

import { failureToast } from "../toast.ts";
import * as ThreadUndo from "./threadUndo.ts";

/**
 * The sidebar's **Undo** notice (T3 Code's
 * `apps/web/src/hooks/showThreadUndoNotice.ts` at 2577baf). Unpinning,
 * settling and archiving each show "Settled 1 thread, Undo" for five
 * seconds; the same action on several threads in a row counts them in one
 * notice, and Undo (or `mod+z`) restores them all. Snooze has the same grouped Undo.
 * An action whose claim was superseded leaves the notice.
 */

export type ThreadUndoAction = "Settled" | "Unpinned" | "Archived" | "Snoozed";

export interface ThreadUndoOptions {
  readonly action: ThreadUndoAction;
  readonly claim: ThreadUndo.ThreadUndoClaim;
  /** Restores the thread; a failure is reported under `failureTitle`. */
  readonly undo: () => Promise<unknown>;
  readonly failureTitle: string;
}

export interface ThreadUndoNotice {
  readonly action: ThreadUndoAction;
  readonly count: number;
  readonly undo: () => Promise<void>;
}

const UNDO_WINDOW_MS = 5_000;

let liveUndos: ReadonlyArray<ThreadUndoOptions> = [];
let notice: ThreadUndoNotice | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const publish = (next: ThreadUndoNotice | null) => {
  notice = next;
  for (const listener of listeners) listener();
};

function refreshNotice(): void {
  liveUndos = liveUndos.filter((entry) => entry.claim.isCurrent());
  const latest = liveUndos.at(-1);
  if (latest === undefined) {
    clearTimeout(expiry);
    if (notice !== null) publish(null);
    return;
  }
  // The latest action and the run of the same action before it.
  const group: Array<ThreadUndoOptions> = [];
  for (let index = liveUndos.length - 1; index >= 0; index -= 1) {
    const entry = liveUndos[index]!;
    if (entry.action !== latest.action) break;
    group.push(entry);
  }
  publish({
    action: latest.action,
    count: group.length,
    undo: async () => {
      const current = group.filter((entry) => liveUndos.includes(entry) && entry.claim.isCurrent());
      liveUndos = liveUndos.filter((entry) => !group.includes(entry));
      // Give up every claim before waiting, so a second click or `mod+z`
      // cannot restore the same threads twice.
      for (const entry of current) entry.claim.finish();
      refreshNotice();
      await Promise.all(
        current.map((entry) =>
          entry.undo().catch((error: unknown) => failureToast(entry.failureTitle, error)),
        ),
      );
    },
  });
}

ThreadUndo.subscribe(refreshNotice);

export function showThreadUndoNotice(options: ThreadUndoOptions): void {
  if (!options.claim.isCurrent()) return;
  liveUndos = [...liveUndos, options];
  refreshNotice();
  clearTimeout(expiry);
  expiry = setTimeout(() => {
    const expired = liveUndos;
    liveUndos = [];
    for (const entry of expired) entry.claim.finish();
    refreshNotice();
  }, UNDO_WINDOW_MS);
}

/** Undoes the notice's actions; false when there is nothing to undo (T3 Code's `thread.undo`). */
export function undoLatestThreadAction(): boolean {
  if (notice === null) return false;
  void notice.undo();
  return true;
}

export const readThreadUndoNotice = (): ThreadUndoNotice | null => notice;

const subscribeNotice = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useThreadUndoNotice(): ThreadUndoNotice | null {
  return useSyncExternalStore(subscribeNotice, readThreadUndoNotice, readThreadUndoNotice);
}

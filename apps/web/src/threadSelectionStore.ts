import { useSyncExternalStore } from "react";

/**
 * The threads selected in the sidebar for a bulk action (T3 Code's
 * `apps/web/src/threadSelectionStore.ts` at 2577baf). Mod-click toggles a
 * thread and anchors there; shift-click selects from the anchor to the
 * clicked thread in the list's order. Both sidebars share it; Escape, a
 * plain click or a change of project scope clears it.
 */

export interface ThreadSelection {
  readonly selectedThreadIds: ReadonlySet<string>;
  readonly anchorThreadId: string | null;
}

const EMPTY: ThreadSelection = { selectedThreadIds: new Set(), anchorThreadId: null };

let state: ThreadSelection = EMPTY;
const listeners = new Set<() => void>();

const publish = (next: ThreadSelection) => {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
};

export const readThreadSelection = (): ThreadSelection => state;

export function toggleThreadSelection(threadId: string): void {
  const next = new Set(state.selectedThreadIds);
  if (next.has(threadId)) next.delete(threadId);
  else next.add(threadId);
  publish({
    selectedThreadIds: next,
    anchorThreadId: next.has(threadId) ? threadId : state.anchorThreadId,
  });
}

export function rangeSelectThreadsTo(threadId: string, orderedThreadIds: ReadonlyArray<string>) {
  const next = new Set(state.selectedThreadIds);
  const anchor = state.anchorThreadId;
  const from = anchor === null ? -1 : orderedThreadIds.indexOf(anchor);
  const to = orderedThreadIds.indexOf(threadId);
  if (from === -1 || to === -1) {
    next.add(threadId);
    publish({ selectedThreadIds: next, anchorThreadId: threadId });
    return;
  }
  for (const id of orderedThreadIds.slice(Math.min(from, to), Math.max(from, to) + 1)) {
    next.add(id);
  }
  publish({ selectedThreadIds: next, anchorThreadId: anchor });
}

export function setThreadSelectionAnchor(threadId: string): void {
  if (state.anchorThreadId === threadId) return;
  publish({ ...state, anchorThreadId: threadId });
}

export function clearThreadSelection(): void {
  if (state.selectedThreadIds.size === 0 && state.anchorThreadId === null) return;
  publish(EMPTY);
}

export function removeFromThreadSelection(threadIds: ReadonlyArray<string>): void {
  const removed = new Set(threadIds);
  const next = new Set([...state.selectedThreadIds].filter((id) => !removed.has(id)));
  if (next.size === state.selectedThreadIds.size) return;
  publish({
    selectedThreadIds: next,
    anchorThreadId:
      state.anchorThreadId !== null && removed.has(state.anchorThreadId)
        ? null
        : state.anchorThreadId,
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useThreadSelection(): ThreadSelection {
  return useSyncExternalStore(subscribe, readThreadSelection, readThreadSelection);
}

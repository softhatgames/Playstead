/**
 * Which thread actions can still be undone (T3 Code's
 * `apps/web/src/hooks/threadUndo.ts` at 2577baf). An action claims its
 * kind and thread when it starts; a later action of the same kind on the
 * same thread, or one that supersedes it, takes the claim, so an older
 * Undo can no longer restore a state that is gone. Shared by every caller,
 * so the sidebar, the header and the keyboard invalidate each other.
 */

const currentActions = new Map<string, symbol>();
const listeners = new Set<() => void>();

const keyOf = (kind: string, threadKey: string) => JSON.stringify([kind, threadKey]);

const notify = () => {
  for (const listener of listeners) listener();
};

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface ThreadUndoClaim {
  readonly isCurrent: () => boolean;
  readonly finish: () => void;
}

export function begin(kind: string, threadKey: string): ThreadUndoClaim {
  const key = keyOf(kind, threadKey);
  const token = Symbol(key);
  currentActions.set(key, token);
  notify();
  const isCurrent = () => currentActions.get(key) === token;
  return {
    isCurrent,
    finish: () => {
      if (!isCurrent()) return;
      currentActions.delete(key);
      notify();
    },
  };
}

export function invalidate(kind: string, threadKey: string): void {
  currentActions.delete(keyOf(kind, threadKey));
  notify();
}

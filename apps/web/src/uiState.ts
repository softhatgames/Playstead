import { useSyncExternalStore } from "react";

/**
 * The interface's own state, kept in the page (T3 Code keeps it in
 * `apps/web/src/uiStateStore.ts` at 2577baf). So far it is the project the
 * person last opened, which the sidebar marks. Opening a project shows its
 * threads once threads exist.
 */

let activeProjectId: string | undefined;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function openProject(projectId: string): void {
  activeProjectId = projectId;
  for (const listener of listeners) listener();
}

export function useActiveProjectId(): string | undefined {
  return useSyncExternalStore(subscribe, () => activeProjectId);
}

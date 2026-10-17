import { useSyncExternalStore } from "react";

/**
 * The interface's own state, kept in the page (T3 Code keeps it in
 * `apps/web/src/uiStateStore.ts` at 2577baf). The last opened project and
 * pending sidebar rename survive page navigation.
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

// Unlike T3's persistent chat layout, these routes remount the sidebar.
// Keep the edit across the navigation triggered by a double-click's first click.
let sidebarThreadRename: { readonly threadId: string; readonly title: string } | null = null;

export function setSidebarThreadRename(
  edit: { readonly threadId: string; readonly title: string } | null,
): void {
  sidebarThreadRename = edit;
  for (const listener of listeners) listener();
}

export function readSidebarThreadRename(threadId: string): string | null {
  return sidebarThreadRename?.threadId === threadId ? sidebarThreadRename.title : null;
}

export function useSidebarThreadRename(threadId: string): string | null {
  return useSyncExternalStore(subscribe, () => readSidebarThreadRename(threadId));
}

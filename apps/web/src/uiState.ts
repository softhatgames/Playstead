import type { ProjectId } from "@playstead/contracts/baseSchemas";
import { useSyncExternalStore } from "react";

/**
 * The interface's own state, kept in the page (T3 Code keeps it in
 * `apps/web/src/uiStateStore.ts` at 2577baf): the project the person last
 * opened, which the sidebar marks, and the project the sidebar is filtered
 * to (T3 Code's `sidebarProjectScopeKey`), or null for every project.
 */

let activeProjectId: string | undefined;
let sidebarProjectFilter: ProjectId | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const publish = () => {
  for (const listener of listeners) listener();
};

export function openProject(projectId: string): void {
  activeProjectId = projectId;
  publish();
}

export function useActiveProjectId(): string | undefined {
  return useSyncExternalStore(subscribe, () => activeProjectId);
}

/** Shows only this project in the sidebar, or every project with null. */
export function setSidebarProjectFilter(projectId: ProjectId | null): void {
  sidebarProjectFilter = projectId;
  publish();
}

export const readSidebarProjectFilter = (): ProjectId | null => sidebarProjectFilter;

export function useSidebarProjectFilter(): ProjectId | null {
  return useSyncExternalStore(subscribe, readSidebarProjectFilter);
}

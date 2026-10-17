import { identity } from "@playstead/shared/identity";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

/**
 * The interface's own state (T3 Code's `apps/web/src/uiStateStore.ts` at
 * 2577baf). In the page only: the project the person last opened, which the
 * project tree marks and **New thread** starts in. Kept in the browser's
 * storage, as T3 Code's store persists it: the project scope of the inbox
 * sidebar (`sidebarProjectScopeKey`, null for every project), and whether
 * the sidebar is shown. Project order and expansion join it with #40.
 */

const STORAGE_KEY = `${identity.urlScheme.production}:ui-state:v1`;

const SHELVES_FOLDED = { working: false, settled: false };
export type SidebarShelf = keyof typeof SHELVES_FOLDED;

const PersistedUiState = Schema.Struct({
  sidebarProjectScopeKey: Schema.NullOr(Schema.String),
  sidebarOpen: Schema.Boolean,
  sidebarShelvesExpanded: Schema.Struct({ working: Schema.Boolean, settled: Schema.Boolean }).pipe(
    Schema.withDecodingDefault(Effect.succeed(SHELVES_FOLDED)),
  ),
  projectExpandedById: Schema.Record(Schema.String, Schema.Boolean).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
type PersistedUiState = typeof PersistedUiState.Type;

const DEFAULT_PERSISTED: PersistedUiState = {
  sidebarProjectScopeKey: null,
  sidebarOpen: true,
  sidebarShelvesExpanded: SHELVES_FOLDED,
  projectExpandedById: {},
};
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(PersistedUiState));
const encode = Schema.encodeSync(Schema.fromJsonString(PersistedUiState));

function readPersisted(): PersistedUiState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_PERSISTED : decode(raw);
  } catch {
    return DEFAULT_PERSISTED;
  }
}

let activeProjectId: string | undefined;
let persisted: PersistedUiState | undefined;
const listeners = new Set<() => void>();

const current = (): PersistedUiState => (persisted ??= readPersisted());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const publish = () => {
  for (const listener of listeners) listener();
};

function persist(patch: Partial<PersistedUiState>): void {
  persisted = { ...current(), ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, encode(persisted));
  } catch {
    // Storage may be full or off; the state still holds for this page.
  }
  publish();
}

export function openProject(projectId: string): void {
  activeProjectId = projectId;
  publish();
}

export const readActiveProjectId = (): string | undefined => activeProjectId;

export function useActiveProjectId(): string | undefined {
  return useSyncExternalStore(subscribe, readActiveProjectId);
}

/** Scopes the inbox sidebar to one project group, or to every project with null. */
export function setSidebarProjectScopeKey(key: string | null): void {
  persist({ sidebarProjectScopeKey: key });
}

export const readSidebarProjectScopeKey = (): string | null => current().sidebarProjectScopeKey;

export function useSidebarProjectScopeKey(): string | null {
  return useSyncExternalStore(subscribe, readSidebarProjectScopeKey);
}

/** Shows or hides the sidebar (`sidebar.toggle`, `mod+b`). */
export function toggleSidebarOpen(): void {
  persist({ sidebarOpen: !current().sidebarOpen });
}

const readSidebarOpen = (): boolean => current().sidebarOpen;

export function useSidebarOpen(): boolean {
  return useSyncExternalStore(subscribe, readSidebarOpen);
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

export function resolveProjectExpanded(
  expanded: Readonly<Record<string, boolean>>,
  projectId: string,
): boolean {
  return expanded[projectId] ?? true;
}
export function setProjectExpanded(projectId: string, expanded: boolean): void {
  persist({ projectExpandedById: { ...current().projectExpandedById, [projectId]: expanded } });
}
export const readProjectExpandedById = (): Readonly<Record<string, boolean>> =>
  current().projectExpandedById;
export function useProjectExpandedById(): Readonly<Record<string, boolean>> {
  return useSyncExternalStore(subscribe, readProjectExpandedById);
}

export function toggleSidebarShelfExpanded(shelf: SidebarShelf): void {
  const expanded = current().sidebarShelvesExpanded;
  persist({ sidebarShelvesExpanded: { ...expanded, [shelf]: !expanded[shelf] } });
}
export const readSidebarShelvesExpanded = () => current().sidebarShelvesExpanded;
export function useSidebarShelvesExpanded() {
  return useSyncExternalStore(subscribe, readSidebarShelvesExpanded);
}

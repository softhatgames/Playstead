import { identity } from "@playstead/shared/identity";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

/**
 * The interface's own state (T3 Code's `apps/web/src/uiStateStore.ts` at
 * 2577baf). In the page only: the project the person last opened, which the
 * project tree marks and **New thread** starts in. Kept in the browser's
 * storage, as T3 Code's store persists it: the project scope of the inbox
 * sidebar (`sidebarProjectScopeKey`, null for every project), whether the
 * sidebar is shown, and the project tree's manual order (`projectOrder`).
 */

const STORAGE_KEY = `${identity.urlScheme.production}:ui-state:v1`;

const PersistedUiState = Schema.Struct({
  sidebarProjectScopeKey: Schema.NullOr(Schema.String),
  sidebarOpen: Schema.Boolean,
  /** The project tree's manual order (T3 Code's `projectOrder`); stored state from before it decodes to none. */
  projectOrder: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
type PersistedUiState = typeof PersistedUiState.Type;

const DEFAULT_PERSISTED: PersistedUiState = {
  sidebarProjectScopeKey: null,
  sidebarOpen: true,
  projectOrder: [],
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

/** Keeps the project tree's manual order (`sidebarProjectSortOrder: "manual"`). */
export function setProjectOrder(order: ReadonlyArray<string>): void {
  persist({ projectOrder: [...order] });
}

const readProjectOrder = (): ReadonlyArray<string> => current().projectOrder;

export function useProjectOrder(): ReadonlyArray<string> {
  return useSyncExternalStore(subscribe, readProjectOrder);
}

/** Shows or hides the sidebar (`sidebar.toggle`, `mod+b`). */
export function toggleSidebarOpen(): void {
  persist({ sidebarOpen: !current().sidebarOpen });
}

const readSidebarOpen = (): boolean => current().sidebarOpen;

export function useSidebarOpen(): boolean {
  return useSyncExternalStore(subscribe, readSidebarOpen);
}

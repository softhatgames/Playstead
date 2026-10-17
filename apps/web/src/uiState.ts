import { identity } from "@playstead/shared/identity";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

/**
 * The interface's own state (T3 Code's `apps/web/src/uiStateStore.ts` at
 * 2577baf). In the page only: the project the person last opened, which the
 * project tree marks and **New thread** starts in. Kept in the browser's
 * storage, as T3 Code's store persists it: the project scope of the inbox
 * sidebar (`sidebarProjectScopeKey`, null for every project), which of its
 * shelves are open (`sidebarShelvesExpanded`), whether the
 * sidebar is shown, the project tree's manual order (`projectOrder`) and
 * which of its projects are folded (`projectExpandedById`).
 */

const STORAGE_KEY = `${identity.urlScheme.production}:ui-state:v1`;

/** The inbox sidebar's folding shelves. */
export type SidebarShelf = "working" | "snoozed" | "settled";

const SHELVES_FOLDED = { working: false, snoozed: false, settled: false } as const;

const PersistedUiState = Schema.Struct({
  sidebarProjectScopeKey: Schema.NullOr(Schema.String),
  sidebarOpen: Schema.Boolean,
  /** The project tree's manual order (T3 Code's `projectOrder`); stored state from before it decodes to none. */
  projectOrder: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /**
   * Whether each project in the tree is open (T3 Code's
   * `projectExpandedById`); a project with no entry is open.
   */
  projectExpandedById: Schema.Record(Schema.String, Schema.Boolean).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  /**
   * Which inbox shelves are open (T3 Code keeps each under its own
   * `t3code:sidebar:*-expanded` key); folded until opened.
   */
  sidebarShelvesExpanded: Schema.Struct({
    working: Schema.Boolean,
    snoozed: Schema.Boolean,
    settled: Schema.Boolean,
  }).pipe(Schema.withDecodingDefault(Effect.succeed(SHELVES_FOLDED))),
});
type PersistedUiState = typeof PersistedUiState.Type;

const DEFAULT_PERSISTED: PersistedUiState = {
  sidebarProjectScopeKey: null,
  sidebarOpen: true,
  projectOrder: [],
  projectExpandedById: {},
  sidebarShelvesExpanded: SHELVES_FOLDED,
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

const readActiveProjectId = (): string | undefined => activeProjectId;

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

/** Whether the tree shows the project open: until it is folded (T3 Code's `resolveProjectExpanded`). */
export function resolveProjectExpanded(
  projectExpandedById: Readonly<Record<string, boolean>>,
  projectId: string,
): boolean {
  return projectExpandedById[projectId] ?? true;
}

/** Opens or folds a project in the tree (T3 Code's `setProjectExpanded`). */
export function setProjectExpanded(projectId: string, expanded: boolean): void {
  const expandedById = current().projectExpandedById;
  if (expandedById[projectId] === expanded) return;
  persist({ projectExpandedById: { ...expandedById, [projectId]: expanded } });
}

export const readProjectExpandedById = (): Readonly<Record<string, boolean>> =>
  current().projectExpandedById;

export function useProjectExpandedById(): Readonly<Record<string, boolean>> {
  return useSyncExternalStore(subscribe, readProjectExpandedById);
}

/** Opens a folded inbox shelf, or folds an open one. */
export function toggleSidebarShelfExpanded(shelf: SidebarShelf): void {
  const expanded = current().sidebarShelvesExpanded;
  persist({ sidebarShelvesExpanded: { ...expanded, [shelf]: !expanded[shelf] } });
}

const readSidebarShelvesExpanded = () => current().sidebarShelvesExpanded;

export function useSidebarShelvesExpanded(): Readonly<Record<SidebarShelf, boolean>> {
  return useSyncExternalStore(subscribe, readSidebarShelvesExpanded);
}

/** Shows or hides the sidebar (`sidebar.toggle`, `mod+b`). */
export function toggleSidebarOpen(): void {
  persist({ sidebarOpen: !current().sidebarOpen });
}

const readSidebarOpen = (): boolean => current().sidebarOpen;

export function useSidebarOpen(): boolean {
  return useSyncExternalStore(subscribe, readSidebarOpen);
}

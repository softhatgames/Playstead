import type { ProjectId } from "@playstead/contracts/baseSchemas";
import type { ClientSettings, ContextMenuItem } from "@playstead/contracts/ipc";
import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

/**
 * The inbox sidebar's logic (T3 Code's `apps/web/src/components/Sidebar.tsx`
 * and `Sidebar.logic.ts`, with `packages/client-runtime/src/state/threadSort.ts`
 * and `threadInbox.ts`, at 2577baf): which section a thread is in, each
 * section's order, the bulk menu and the project scope.
 */

type SidebarThread = OrchestrationV2ThreadShell;

/**
 * Where a thread shows in the inbox sidebar. **Snoozed** (#38) comes before
 * Settled when it arrives; **Working** is the optional shelf for threads at
 * work, which a pinned thread never leaves Pinned for.
 */
export type SidebarSection = "pinned" | "active" | "working" | "settled";

function resolveSidebarThreadSection(
  thread: Pick<SidebarThread, "settledOverride" | "pinnedAt">,
): Exclude<SidebarSection, "working"> {
  if (thread.settledOverride === "settled") return "settled";
  if (thread.pinnedAt !== null) return "pinned";
  return "active";
}

const timeOf = (iso: string | null): number => {
  if (iso === null) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
};

const compareKeys = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const byId = (left: SidebarThread, right: SidebarThread) => left.id.localeCompare(right.id);

/**
 * Whether the thread's agent is at work, so the Working shelf takes it (T3
 * Code's `isThreadWorking`): its run is starting or running. A run waiting
 * on the person comes back to Active, as it needs them.
 */
const isSidebarThreadWorking = (thread: Pick<SidebarThread, "status">): boolean =>
  thread.status === "starting" || thread.status === "running";

/** Pinned threads by order key, then the keyless ones newest first (T3 Code's `sortPinnedThreadsByOrderKey`). */
function sortPinnedThreads<T extends SidebarThread>(threads: ReadonlyArray<T>): T[] {
  const keyed = threads.filter((thread) => thread.pinOrderKey !== null);
  const keyless = threads.filter((thread) => thread.pinOrderKey === null);
  keyed.sort(
    (left, right) => compareKeys(left.pinOrderKey!, right.pinOrderKey!) || byId(left, right),
  );
  keyless.sort(
    (left, right) => timeOf(right.createdAt) - timeOf(left.createdAt) || byId(left, right),
  );
  return [...keyed, ...keyless];
}

/**
 * Active threads (T3 Code's `sortActiveThreadsByOrderKey`): the ones not yet
 * arranged on top, newest first by when they were created or un-settled,
 * then the arranged ones by order key. Activity does not reorder them.
 */
function sortActiveThreads<T extends SidebarThread>(threads: ReadonlyArray<T>): T[] {
  const anchor = (thread: T) => Math.max(timeOf(thread.createdAt), timeOf(thread.unsettledAt));
  return [...threads].sort((left, right) => {
    const leftKey = left.activeOrderKey;
    const rightKey = right.activeOrderKey;
    if (leftKey === null && rightKey !== null) return -1;
    if (leftKey !== null && rightKey === null) return 1;
    const order =
      leftKey !== null && rightKey !== null
        ? compareKeys(leftKey, rightKey)
        : anchor(right) - anchor(left);
    return order || byId(left, right);
  });
}

/**
 * Settled threads, newest settlement first (T3 Code's `sortSettledThreads`),
 * falling back to the latest run's times for a thread without one.
 */
function sortSettledThreads<T extends SidebarThread>(threads: ReadonlyArray<T>): T[] {
  const settledTime = (thread: T) =>
    thread.settledAt !== null
      ? timeOf(thread.settledAt)
      : Math.max(timeOf(thread.latestRunRequestedAt), timeOf(thread.latestRunCompletedAt)) ||
        timeOf(thread.updatedAt);
  return [...threads].sort(
    (left, right) => settledTime(right) - settledTime(left) || byId(left, right),
  );
}

/**
 * With the Working shelf on, Active is ordered by when each thread last came
 * back to the person (T3 Code's `sortInboxThreadsByReturn`): it was created,
 * un-settled, sent work or finished it, or was seen to stop working.
 */
function sortInboxThreadsByReturn<T extends SidebarThread>(
  threads: ReadonlyArray<T>,
  returnedAt: (thread: T) => number | undefined = () => undefined,
): T[] {
  const returned = (thread: T) =>
    Math.max(
      timeOf(thread.createdAt),
      timeOf(thread.unsettledAt),
      timeOf(thread.latestRunRequestedAt),
      timeOf(thread.latestRunCompletedAt),
      returnedAt(thread) ?? 0,
    );
  return [...threads].sort((left, right) => returned(right) - returned(left) || byId(left, right));
}

/** The Working shelf, the thread last sent work first (T3 Code's `sortWorkingThreadsBySend`). */
function sortWorkingThreadsBySend<T extends SidebarThread>(threads: ReadonlyArray<T>): T[] {
  const sent = (thread: T) =>
    Math.max(timeOf(thread.createdAt), timeOf(thread.latestRunRequestedAt));
  return [...threads].sort((left, right) => sent(right) - sent(left) || byId(left, right));
}

/**
 * Remembers when each thread stopped working, so it can come back to the top
 * of Active (T3 Code's `createInboxReturnTracker`). Keep one for the page;
 * `observe` every list of threads, or null while the shelf is off.
 */
export function createInboxReturnTracker() {
  let lastWorking: ReadonlySet<string> | null = null;
  const returns = new Map<string, number>();
  return {
    observe(threads: ReadonlyArray<SidebarThread> | null, now: number): void {
      if (threads === null) {
        lastWorking = null;
        returns.clear();
        return;
      }
      const present = new Set<string>(threads.map((thread) => thread.id));
      const working = new Set<string>(
        threads.filter(isSidebarThreadWorking).map((thread) => thread.id),
      );
      for (const id of returns.keys()) if (!present.has(id)) returns.delete(id);
      for (const id of lastWorking ?? []) {
        if (present.has(id) && !working.has(id)) returns.set(id, now);
      }
      lastWorking = working;
    },
    returnedAt: (thread: Pick<SidebarThread, "id">) => returns.get(thread.id),
  };
}

export interface SidebarSections {
  readonly pinned: ReadonlyArray<SidebarThread>;
  readonly active: ReadonlyArray<SidebarThread>;
  readonly working: ReadonlyArray<SidebarThread>;
  readonly settled: ReadonlyArray<SidebarThread>;
}

/**
 * Splits the shell's threads into the inbox sidebar's sections, each in its
 * order (T3 Code's section memo in `Sidebar.tsx`). Only the scoped
 * projects' threads show, or every project's with null.
 */
export function buildSidebarSections(input: {
  readonly threads: ReadonlyArray<SidebarThread>;
  readonly scopedProjectIds: ReadonlySet<string> | null;
  readonly workingShelfEnabled: boolean;
  readonly returnedAt?: (thread: SidebarThread) => number | undefined;
}): SidebarSections {
  const pinned: SidebarThread[] = [];
  const active: SidebarThread[] = [];
  const working: SidebarThread[] = [];
  const settled: SidebarThread[] = [];
  for (const thread of input.threads) {
    if (thread.archivedAt !== null || thread.deletedAt !== null) continue;
    if (input.scopedProjectIds !== null && !input.scopedProjectIds.has(thread.projectId)) continue;
    const section = resolveSidebarThreadSection(thread);
    if (section === "pinned") pinned.push(thread);
    else if (section === "settled") settled.push(thread);
    else if (input.workingShelfEnabled && isSidebarThreadWorking(thread)) working.push(thread);
    else active.push(thread);
  }
  return {
    pinned: sortPinnedThreads(pinned),
    active: input.workingShelfEnabled
      ? sortInboxThreadsByReturn(active, input.returnedAt)
      : sortActiveThreads(active),
    working: sortWorkingThreadsBySend(working),
    settled: sortSettledThreads(settled),
  };
}

export type MultiSelectThreadMenuId =
  | "unpin"
  | "settle"
  | "regenerate-title"
  | "mark-unread"
  | "archive"
  | "delete";

/**
 * The menu for several selected threads. The inbox sidebar's (T3 Code's
 * `handleMultiSelectContextMenu`) offers Unpin when some are pinned, Settle,
 * Regenerate titles once threads can, Mark unread and Delete; **Snooze**
 * (#38) joins after Settle. The project tree's (T3 Code's
 * `buildMultiSelectThreadContextMenuItems`) offers Mark unread, Archive
 * unless one is working, and Delete.
 */
export function buildMultiSelectThreadContextMenuItems(input: {
  readonly variant: "inbox" | "tree";
  readonly count: number;
  readonly pinnedCount: number;
  /** The selected threads not settled yet. */
  readonly settleableCount: number;
  readonly hasRunningThread: boolean;
  /** Null until threads can regenerate their titles. */
  readonly titleRegeneration: {
    readonly supportedCount: number;
    readonly actionableCount: number;
  } | null;
}): ReadonlyArray<ContextMenuItem<MultiSelectThreadMenuId>> {
  const { count } = input;
  if (input.variant === "tree") {
    return [
      { id: "mark-unread", label: `Mark unread (${count})` },
      { id: "archive", label: `Archive (${count})`, disabled: input.hasRunningThread },
      { id: "delete", label: `Delete (${count})`, destructive: true },
    ];
  }
  const regeneration = input.titleRegeneration;
  const regenerateItems: ReadonlyArray<ContextMenuItem<MultiSelectThreadMenuId>> =
    regeneration === null || regeneration.supportedCount === 0
      ? []
      : [
          regeneration.actionableCount === 0
            ? {
                id: "regenerate-title",
                label: `Regenerating… (${regeneration.supportedCount})`,
                disabled: true,
              }
            : {
                id: "regenerate-title",
                label: `Regenerate titles (${regeneration.actionableCount})`,
              },
        ];
  return [
    ...(input.pinnedCount > 0
      ? [{ id: "unpin" as const, label: `Unpin (${input.pinnedCount})` }]
      : []),
    { id: "settle", label: `Settle (${count})`, disabled: input.settleableCount === 0 },
    ...regenerateItems,
    { id: "mark-unread", label: `Mark unread (${count})` },
    { id: "delete", label: `Delete (${count})`, destructive: true },
  ];
}

export type SidebarProjectSortOrder = ClientSettings["sidebarProjectSortOrder"];

/** A choice in the project scope menu: one project, or every thread without one. */
export interface SidebarProjectGroup {
  readonly key: string;
  readonly displayName: string;
  readonly projectIds: ReadonlyArray<ProjectId>;
  readonly isScratch: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const SCRATCH_GROUP_KEY = "scratch";

/**
 * The projects the scope menu offers (T3 Code's `useSidebarProjectGroups`,
 * `buildSidebarProjectSnapshots` with `groupScratchProjects`, and
 * `sortSidebarV2ProjectGroups`). Each project is its own group: T3 Code
 * merges the projects of one repository (`sidebarProjectGroupingMode`),
 * which Playstead cannot see until version control (slice 4). The
 * "No project" projects (#43) make one group. Groups are ordered by their
 * latest thread activity (`updated_at`), by creation (`created_at`), or as
 * the server lists them (`manual`, until #40 lets the person arrange them),
 * ties by name.
 */
export function buildSidebarProjectGroups(input: {
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly threads: ReadonlyArray<SidebarThread>;
  readonly sortOrder: SidebarProjectSortOrder;
  readonly isScratchProject?: (project: OrchestrationProjectShell) => boolean;
}): ReadonlyArray<SidebarProjectGroup> {
  const isScratch = input.isScratchProject ?? (() => false);
  const scratch = input.projects.filter(isScratch);
  const groups: SidebarProjectGroup[] = input.projects
    .filter((project) => !isScratch(project))
    .map((project) => ({
      key: project.id,
      displayName: project.title,
      projectIds: [project.id],
      isScratch: false,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }));
  if (scratch.length > 0) {
    groups.push({
      key: SCRATCH_GROUP_KEY,
      displayName: "No project",
      projectIds: scratch.map((project) => project.id),
      isScratch: true,
      createdAt: scratch.map((project) => project.createdAt).toSorted()[0]!,
      updatedAt: scratch
        .map((project) => project.updatedAt)
        .toSorted()
        .at(-1)!,
    });
  }
  if (input.sortOrder === "manual") return groups;

  const threadTime = (thread: SidebarThread) =>
    input.sortOrder === "created_at"
      ? timeOf(thread.createdAt)
      : timeOf(thread.latestRunRequestedAt) || timeOf(thread.updatedAt) || timeOf(thread.createdAt);
  const groupTime = (group: SidebarProjectGroup) => {
    const members = new Set<string>(group.projectIds);
    const times = input.threads
      .filter((thread) => thread.archivedAt === null && members.has(thread.projectId))
      .map(threadTime);
    if (times.length > 0) return Math.max(...times);
    return input.sortOrder === "created_at" ? timeOf(group.createdAt) : timeOf(group.updatedAt);
  };
  const times = new Map(groups.map((group) => [group.key, groupTime(group)]));
  return groups.toSorted(
    (left, right) =>
      times.get(right.key)! - times.get(left.key)! ||
      left.displayName.localeCompare(right.displayName) ||
      left.key.localeCompare(right.key),
  );
}

/**
 * The group the sidebar is scoped to, or null for every project; a scope to
 * a project that is gone shows every project (T3 Code's
 * `resolveSidebarProjectScopeKey`).
 */
export function resolveSidebarProjectScope(
  groups: ReadonlyArray<SidebarProjectGroup>,
  key: string | null,
): SidebarProjectGroup | null {
  if (key === null) return null;
  return groups.find((group) => group.key === key) ?? null;
}

/**
 * Where the view goes when the thread in it is settled (T3 Code's
 * `planForwardNavigation` in `Sidebar.tsx`): the next thread in the
 * sidebar's order, wrapping round, that is not parked (settled, and snoozed
 * once #38 arrives) or being parked with it; null when there is none, for
 * the caller to open a new draft in the thread's project.
 */
export function threadAfterPark(input: {
  readonly orderedIds: ReadonlyArray<string>;
  readonly parkedIds: ReadonlySet<string>;
  readonly threadId: string;
  readonly coParkingIds?: ReadonlySet<string>;
}): string | null {
  const index = input.orderedIds.indexOf(input.threadId);
  if (index === -1) return null;
  const rest = [...input.orderedIds.slice(index + 1), ...input.orderedIds.slice(0, index)];
  return (
    rest.find((id) => !input.parkedIds.has(id) && input.coParkingIds?.has(id) !== true) ?? null
  );
}

/**
 * A row's time since `iso` (T3 Code's `formatRelativeTime` with
 * `compactSidebarTimeLabel`): "now" under a minute, then minutes, hours and
 * days.
 */
export function compactTimeLabel(iso: string, now: number): string {
  const seconds = Math.floor((now - timeOf(iso)) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

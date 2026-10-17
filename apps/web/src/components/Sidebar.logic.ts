import {
  isThreadWorking,
  sortInboxThreadsByReturn,
  sortWorkingThreadsBySend,
} from "@playstead/client-runtime/state/threadInbox";
import {
  effectiveSnoozed,
  type SnoozePreset,
  threadWokeAt,
} from "@playstead/client-runtime/state/threadSettled";
import {
  sortActiveThreadsByOrderKey,
  sortPinnedThreadsByOrderKey,
  sortSettledThreads,
} from "@playstead/client-runtime/state/threadSort";
import type { ContextMenuItem } from "@playstead/contracts/ipc";
import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2ThreadShell,
} from "@playstead/contracts/orchestrationV2";

import { type SnoozeMenuId, snoozeMenuChildren } from "./Sidebar.snooze.ts";

type SidebarThread = OrchestrationV2ThreadShell;

const timeOf = (iso: string | null): number => {
  if (iso === null) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * Where a thread shows in the inbox sidebar (T3 Code's
 * `resolveSidebarThreadSection` in `apps/web/src/components/Sidebar.logic.ts`
 * at 2577baf): a snoozed thread is in **Snoozed** until it wakes, even a
 * settled one; then **Settled**, **Pinned** and **Active**. **Working** is
 * the optional shelf for threads at work, which a pinned thread never
 * leaves Pinned for.
 */
export type SidebarSection = "pinned" | "active" | "working" | "snoozed" | "settled";

function resolveSidebarThreadSection(
  thread: SidebarThread,
  now: string,
): Exclude<SidebarSection, "working"> {
  if (effectiveSnoozed(thread, { now })) return "snoozed";
  if (thread.settledOverride === "settled") return "settled";
  if (thread.pinnedAt !== null) return "pinned";
  return "active";
}

export interface SidebarSections {
  readonly pinned: ReadonlyArray<SidebarThread>;
  readonly active: ReadonlyArray<SidebarThread>;
  readonly working: ReadonlyArray<SidebarThread>;
  readonly snoozed: ReadonlyArray<SidebarThread>;
  readonly settled: ReadonlyArray<SidebarThread>;
}

/**
 * Splits the shell's threads into the inbox sidebar's sections, each in its
 * order (T3 Code's section memo in `Sidebar.tsx`, with the sorts of
 * `packages/client-runtime/src/state/threadSort.ts` and `threadInbox.ts`).
 * Only the scoped projects' threads show, or every project's with null.
 * Snoozed threads are as they are at `now` (the present by default), the
 * earliest wake first.
 */
export function buildSidebarSections(input: {
  readonly threads: ReadonlyArray<SidebarThread>;
  readonly scopedProjectIds: ReadonlySet<string> | null;
  readonly workingShelfEnabled: boolean;
  readonly returnedAt?: (thread: SidebarThread) => number | undefined;
  readonly now?: string;
}): SidebarSections {
  const now = input.now ?? new Date().toISOString();
  const pinned: SidebarThread[] = [];
  const active: SidebarThread[] = [];
  const working: SidebarThread[] = [];
  const snoozed: SidebarThread[] = [];
  const settled: SidebarThread[] = [];
  for (const thread of input.threads) {
    if (thread.archivedAt !== null || thread.deletedAt !== null) continue;
    if (input.scopedProjectIds !== null && !input.scopedProjectIds.has(thread.projectId)) continue;
    const section = resolveSidebarThreadSection(thread, now);
    if (section === "pinned") pinned.push(thread);
    else if (section === "snoozed") snoozed.push(thread);
    else if (section === "settled") settled.push(thread);
    else if (input.workingShelfEnabled && isThreadWorking(thread)) working.push(thread);
    else active.push(thread);
  }
  return {
    pinned: sortPinnedThreadsByOrderKey(pinned),
    active: input.workingShelfEnabled
      ? sortInboxThreadsByReturn(active, input.returnedAt)
      : sortActiveThreadsByOrderKey(active),
    working: sortWorkingThreadsBySend(working),
    snoozed: snoozed.sort(
      (left, right) =>
        timeOf(left.snoozedUntil) - timeOf(right.snoozedUntil) || left.id.localeCompare(right.id),
    ),
    settled: sortSettledThreads(settled),
  };
}

export type MultiSelectThreadMenuId =
  | "unpin"
  | "settle"
  | "snooze"
  | SnoozeMenuId
  | "regenerate-title"
  | "mark-unread"
  | "archive"
  | "delete";

/**
 * The menu for several selected threads. The inbox sidebar's (T3 Code's
 * `handleMultiSelectContextMenu`) offers Unpin when some are pinned, Settle,
 * **Snooze** with its presets when every one can be snoozed, Regenerate
 * titles, Mark unread and Delete. The project tree's (T3 Code's
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
  /** The presets, or null when some selected thread cannot be snoozed now. */
  readonly snooze?: { readonly presets: ReadonlyArray<SnoozePreset> } | null;
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
    ...(input.snooze == null
      ? []
      : [
          {
            id: "snooze" as const,
            label: `Snooze (${count})`,
            children: snoozeMenuChildren(input.snooze.presets),
          },
        ]),
    ...regenerateItems,
    { id: "mark-unread", label: `Mark unread (${count})` },
    { id: "delete", label: `Delete (${count})`, destructive: true },
  ];
}

/**
 * Where the view goes when the thread in it is settled or snoozed (T3 Code's
 * `planForwardNavigation` in `Sidebar.tsx`): the next thread in the
 * sidebar's order, wrapping round, that is not parked (settled or snoozed)
 * or being parked with it; null when there is none, for
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

/**
 * Whether the thread shows the unseen-completion dot (T3 Code's
 * `hasUnseenCompletion` in `apps/web/src/components/Sidebar.logic.ts` at
 * 2577baf): its latest run completed after the thread was last visited. A
 * thread never visited shows none. The server's read marker is the only
 * one; T3 Code's browser-local fallback is for servers without it.
 */
export function hasUnseenCompletion(
  thread: Pick<OrchestrationV2ThreadShell, "latestRunCompletedAt" | "lastVisitedAt">,
): boolean {
  if (thread.latestRunCompletedAt === null || thread.lastVisitedAt === null) return false;
  const completedAt = Date.parse(thread.latestRunCompletedAt);
  if (Number.isNaN(completedAt)) return false;
  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

/** The status a thread row shows before its title (T3 Code's thread status pill, Playstead's two). */
export type ThreadStatusLabel = "Working" | "Completed";

/** T3 Code's `THREAD_STATUS_PRIORITY` for the statuses Playstead shows. */
const THREAD_STATUS_PRIORITY: Record<ThreadStatusLabel, number> = { Working: 4, Completed: 1 };

/** The thread's row status: working while its run is, else an unseen completion. */
export function threadStatusLabel(
  thread: Pick<OrchestrationV2ThreadShell, "status" | "latestRunCompletedAt" | "lastVisitedAt">,
): ThreadStatusLabel | null {
  if (thread.status !== "idle" && ACTIVE_RUN_STATUSES.has(thread.status)) return "Working";
  return hasUnseenCompletion(thread) ? "Completed" : null;
}

/**
 * When the thread woke from its snooze, while its row shows **Woke** (T3
 * Code's `isWoke` and `topStatus` in `SidebarThreadRow`): from the wake
 * until the thread is visited after it, unless it is settled. A thread at
 * work, waiting on the person or failed shows that instead.
 */
export function resolveSidebarThreadWokeAt(
  thread: Pick<
    OrchestrationV2ThreadShell,
    | "status"
    | "latestRunCompletedAt"
    | "lastVisitedAt"
    | "settledOverride"
    | "snoozedUntil"
    | "snoozedAt"
    | "hasPendingUserInput"
  >,
  options: { readonly now: string },
): string | null {
  if (thread.settledOverride === "settled" || thread.hasPendingUserInput) return null;
  if (thread.status === "failed" || threadStatusLabel(thread) === "Working") return null;
  const wokeAt = threadWokeAt(thread, options);
  if (wokeAt === null) return null;
  const visitedAt = thread.lastVisitedAt === null ? Number.NaN : Date.parse(thread.lastVisitedAt);
  return Number.isNaN(visitedAt) || visitedAt < Date.parse(wokeAt) ? wokeAt : null;
}

/**
 * What a folded project, or the threads behind **Show more**, show in the
 * tree: the most pressing status of the threads (T3 Code's
 * `resolveProjectStatusIndicator`).
 */
export function resolveProjectStatusIndicator(
  threads: ReadonlyArray<
    Pick<OrchestrationV2ThreadShell, "status" | "latestRunCompletedAt" | "lastVisitedAt">
  >,
): ThreadStatusLabel | null {
  let highest: ThreadStatusLabel | null = null;
  for (const thread of threads) {
    const status = threadStatusLabel(thread);
    if (status === null) continue;
    if (highest === null || THREAD_STATUS_PRIORITY[status] > THREAD_STATUS_PRIORITY[highest]) {
      highest = status;
    }
  }
  return highest;
}

/**
 * A double-click sends two clicks before `dblclick`, the second with
 * `detail` 2; that one must not run a row's single-click navigation, or
 * double-click-to-rename would navigate too (T3 Code's
 * `isTrailingDoubleClick`). Keyboard activations have `detail` 0.
 */
export function isTrailingDoubleClick(detail: number): boolean {
  return detail > 1;
}

/**
 * The project tree's projects in the chosen order (T3 Code's
 * `sortProjectsForSidebar` over `orderItemsByPreferredIds` in
 * `LegacySidebar.tsx`): newest first by their threads' latest message
 * (`updated_at`) or creation (`created_at`), a project without threads by
 * its own time; or `manual`, the person's `projectOrder` (from the ui
 * state), projects it does not name after it in the server's order. Ties
 * go by title.
 */
export function sortTreeProjects<
  P extends {
    readonly id: string;
    readonly title: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  },
>(input: {
  readonly projects: ReadonlyArray<P>;
  readonly threads: ReadonlyArray<
    Pick<
      OrchestrationV2ThreadShell,
      "createdAt" | "updatedAt" | "latestRunRequestedAt" | "archivedAt"
    > & { readonly projectId: string }
  >;
  readonly sortOrder: "updated_at" | "created_at" | "manual";
  readonly projectOrder: ReadonlyArray<string>;
}): P[] {
  if (input.sortOrder === "manual") {
    const rank = new Map(input.projectOrder.map((id, index) => [id, index]));
    const ranked = input.projects.filter((project) => rank.has(project.id));
    ranked.sort((left, right) => rank.get(left.id)! - rank.get(right.id)!);
    return [...ranked, ...input.projects.filter((project) => !rank.has(project.id))];
  }
  const latest = new Map<string, number>();
  for (const thread of input.threads) {
    if (thread.archivedAt !== null) continue;
    const time =
      input.sortOrder === "created_at"
        ? timeOf(thread.createdAt)
        : timeOf(thread.latestRunRequestedAt) || timeOf(thread.updatedAt);
    latest.set(thread.projectId, Math.max(latest.get(thread.projectId) ?? 0, time));
  }
  const timeOfProject = (project: P) =>
    latest.get(project.id) ??
    timeOf(input.sortOrder === "created_at" ? project.createdAt : project.updatedAt);
  return input.projects.toSorted(
    (left, right) =>
      timeOfProject(right) - timeOfProject(left) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
}

/**
 * The project order after dragging `draggedId` onto `targetId` (T3 Code's
 * `reorderProjects` in `uiStateStore.ts`): the dragged project takes the
 * target's place, the target moving aside toward where the dragged one
 * came from. The same order when either is missing or they are the same.
 */
export function reorderProjects(
  order: ReadonlyArray<string>,
  draggedId: string,
  targetId: string,
): ReadonlyArray<string> {
  const from = order.indexOf(draggedId);
  const to = order.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return order;
  const next = order.filter((id) => id !== draggedId);
  next.splice(to, 0, draggedId);
  return next;
}

/**
 * The sidebar's thread search results (T3 Code's `searchSidebarThreads`):
 * threads whose title holds the query, then those the server matched by a
 * message (`messageMatchIds`), each in the order given. Titles are matched
 * here; only messages go to the server.
 */
export function searchSidebarThreads<T extends { readonly id: string; readonly title: string }>(
  threads: ReadonlyArray<T>,
  query: string,
  messageMatchIds: ReadonlySet<string>,
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const titleMatches: T[] = [];
  const messageMatches: T[] = [];
  for (const thread of threads) {
    if (thread.title.toLowerCase().includes(needle)) titleMatches.push(thread);
    else if (messageMatchIds.has(thread.id)) messageMatches.push(thread);
  }
  return [...titleMatches, ...messageMatches];
}

/** The highlighted result after an arrow key, wrapping at either end. */
export function moveSearchHighlight(index: number, count: number, direction: "up" | "down") {
  return direction === "down" ? (index + 1) % count : (index - 1 + count) % count;
}

interface SearchHighlightPart {
  readonly text: string;
  readonly highlighted: boolean;
  readonly start: number;
}

// The server's `LIKE` folds ASCII letters only, so the highlight does the same.
const foldAsciiCase = (value: string) =>
  value.replace(/[A-Z]/g, (character) => character.toLowerCase());

/**
 * A snippet cut into the parts that match the query and those that do not
 * (T3 Code's `HighlightedSearchText` in `ThreadSearchMatch.tsx`).
 */
export function splitSearchHighlights(text: string, query: string): SearchHighlightPart[] {
  const needle = foldAsciiCase(query.trim());
  if (needle.length === 0) return [{ text, highlighted: false, start: 0 }];
  const folded = foldAsciiCase(text);
  const parts: SearchHighlightPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const at = folded.indexOf(needle, cursor);
    if (at === -1) {
      parts.push({ text: text.slice(cursor), highlighted: false, start: cursor });
      break;
    }
    if (at > cursor)
      parts.push({ text: text.slice(cursor, at), highlighted: false, start: cursor });
    parts.push({ text: text.slice(at, at + needle.length), highlighted: true, start: at });
    cursor = at + needle.length;
  }
  return parts;
}

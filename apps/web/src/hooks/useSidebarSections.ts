import { createInboxReturnTracker } from "@playstead/client-runtime/state/threadInbox";
import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useClientSettings } from "../clientSettings.ts";
import { buildSidebarSections, type SidebarSections } from "../components/Sidebar.logic.ts";
import {
  buildSidebarProjectGroups,
  resolveSidebarProjectScope,
  type SidebarProjectGroup,
} from "../sidebarProjectGrouping.ts";
import { clearThreadSelection } from "../threadSelectionStore.ts";
import { useSidebarProjectScopeKey } from "../uiState.ts";
import { useIsScratchProject } from "./useScratchProject.ts";

type SidebarThread = OrchestrationV2ThreadShell;

const SETTLED_TAIL_INITIAL_COUNT = 10;
const SETTLED_TAIL_PAGE_COUNT = 25;
const SETTLED_SHELF_EXPANDED_KEY = "playstead:sidebar:settled-expanded";
const WORKING_SHELF_EXPANDED_KEY = "playstead:sidebar:working-expanded";
const SNOOZED_SHELF_EXPANDED_KEY = "playstead:sidebar:snoozed-expanded";
// The longest delay `setTimeout` takes; a later wake is checked again then.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

// One for the page, so the Working shelf's return order survives the sidebar remounting.
const inboxReturns = createInboxReturnTracker();

/** When a thread came back to Active, for the Working shelf's order (see `createInboxReturnTracker`). */
export const inboxReturnedAt = inboxReturns.returnedAt;

/**
 * The project groups the inbox can be scoped to, and the scope (T3 Code's
 * `useSidebarProjectGroups` and `sidebarProjectScopeKey`). Changing the
 * scope clears the selection.
 */
export function useSidebarProjectScope(
  projects: ReadonlyArray<OrchestrationProjectShell>,
  threads: ReadonlyArray<SidebarThread>,
) {
  const { sidebarProjectSortOrder } = useClientSettings();
  const isScratchProject = useIsScratchProject();
  const groups = useMemo(
    () =>
      buildSidebarProjectGroups({
        projects,
        threads,
        sortOrder: sidebarProjectSortOrder,
        isScratchProject,
      }),
    [projects, threads, sidebarProjectSortOrder, isScratchProject],
  );
  const scopeKey = useSidebarProjectScopeKey();
  const scopedGroup: SidebarProjectGroup | null = resolveSidebarProjectScope(groups, scopeKey);
  const scopedProjectIds = useMemo(
    () => (scopedGroup === null ? null : new Set<string>(scopedGroup.projectIds)),
    [scopedGroup],
  );
  useEffect(() => clearThreadSelection(), [scopeKey]);
  return { groups, scopeKey, scopedGroup, scopedProjectIds };
}

/** A shelf's open state, kept in the browser as T3 Code's `useLocalStorage` keeps it. */
function useStoredBoolean(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === "true";
    } catch {
      return initial;
    }
  });
  const toggle = useCallback(() => {
    setValue((current) => {
      try {
        window.localStorage.setItem(key, String(!current));
      } catch {
        // The shelf still toggles for this page.
      }
      return !current;
    });
  }, [key]);
  return [value, toggle] as const;
}

export interface SidebarShelf {
  readonly expanded: boolean;
  readonly toggle: () => void;
}

export interface SidebarSectionsView {
  readonly sections: SidebarSections;
  readonly shelves: {
    readonly working: SidebarShelf;
    readonly snoozed: SidebarShelf;
    readonly settled: SidebarShelf;
  };
  /** The rows each folded or paged shelf shows; a folded shelf still shows the thread in view. */
  readonly visibleWorking: ReadonlyArray<SidebarThread>;
  readonly visibleSnoozed: ReadonlyArray<SidebarThread>;
  readonly visibleSettled: ReadonlyArray<SidebarThread>;
  readonly settledVisibleCount: number;
  /** Settled threads past the page, for **Show N more**. */
  readonly hiddenSettledCount: number;
  readonly showMoreSettled: () => void;
  readonly settledPageCount: number;
  /** Every row shown, top to bottom. */
  readonly orderedThreads: ReadonlyArray<SidebarThread>;
}

/**
 * The inbox's sections as shown (T3 Code's section memo in `Sidebar.tsx`):
 * Pinned, Active, the Working shelf, Snoozed and Settled, folded or open,
 * Settled a page at a time. A snoozed thread leaves Snoozed when its time
 * comes, with no event: a timer for the earliest wake builds the sections
 * again.
 */
export function useSidebarSections(input: {
  /** The threads as the server has them, for the Working shelf's return times. */
  readonly threads: ReadonlyArray<SidebarThread>;
  /** The threads with a pending drop applied. */
  readonly projectedThreads: ReadonlyArray<SidebarThread>;
  readonly scopedProjectIds: ReadonlySet<string> | null;
  readonly scopeKey: string | null;
  readonly routeThreadId: string | undefined;
}): SidebarSectionsView {
  const { threads, projectedThreads, scopedProjectIds, scopeKey, routeThreadId } = input;
  const workingShelfEnabled = useClientSettings().sidebarWorkingShelfEnabled;

  // Bumped when the earliest snooze is due, so the sections are built again.
  const [snoozeWakeTick, bumpSnoozeWakeTick] = useState(0);
  const sections = useMemo(() => {
    void snoozeWakeTick;
    inboxReturns.observe(workingShelfEnabled ? threads : null, Date.now());
    return buildSidebarSections({
      threads: projectedThreads,
      scopedProjectIds,
      workingShelfEnabled,
      returnedAt: inboxReturns.returnedAt,
      now: new Date().toISOString(),
    });
  }, [threads, projectedThreads, scopedProjectIds, workingShelfEnabled, snoozeWakeTick]);
  const nextWakeAt = sections.snoozed[0]?.snoozedUntil ?? null;
  useEffect(() => {
    if (nextWakeAt === null) return;
    const wakeAt = Date.parse(nextWakeAt);
    if (Number.isNaN(wakeAt)) return;
    const delay = Math.min(Math.max(0, wakeAt - Date.now()) + 50, MAX_TIMER_DELAY_MS);
    const timer = window.setTimeout(() => bumpSnoozeWakeTick((tick) => tick + 1), delay);
    return () => window.clearTimeout(timer);
  }, [nextWakeAt, snoozeWakeTick]);

  const [settledExpanded, toggleSettled] = useStoredBoolean(SETTLED_SHELF_EXPANDED_KEY, false);
  const [workingExpanded, toggleWorking] = useStoredBoolean(WORKING_SHELF_EXPANDED_KEY, false);
  const [snoozedExpanded, toggleSnoozed] = useStoredBoolean(SNOOZED_SHELF_EXPANDED_KEY, false);
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_TAIL_INITIAL_COUNT);
  useEffect(() => setSettledVisibleCount(SETTLED_TAIL_INITIAL_COUNT), [scopeKey]);
  const showMoreSettled = useCallback(
    () => setSettledVisibleCount((count) => count + SETTLED_TAIL_PAGE_COUNT),
    [],
  );

  const { visibleSettled, hiddenSettledCount, visibleWorking, visibleSnoozed } = useMemo(() => {
    const shelfRows = (rows: ReadonlyArray<SidebarThread>, expanded: boolean) =>
      expanded ? rows : rows.filter((thread) => thread.id === routeThreadId);
    const settledPage = sections.settled.slice(0, settledVisibleCount);
    const settledTail = sections.settled
      .slice(settledVisibleCount)
      .filter((thread) => thread.id === routeThreadId);
    return {
      visibleSettled: shelfRows([...settledPage, ...settledTail], settledExpanded),
      hiddenSettledCount: sections.settled.length - settledPage.length - settledTail.length,
      visibleWorking: shelfRows(sections.working, workingExpanded),
      visibleSnoozed: shelfRows(sections.snoozed, snoozedExpanded),
    };
  }, [
    sections.settled,
    sections.working,
    sections.snoozed,
    settledVisibleCount,
    settledExpanded,
    workingExpanded,
    snoozedExpanded,
    routeThreadId,
  ]);

  const orderedThreads = useMemo(
    () => [
      ...sections.pinned,
      ...sections.active,
      ...visibleWorking,
      ...visibleSnoozed,
      ...visibleSettled,
    ],
    [sections.pinned, sections.active, visibleWorking, visibleSnoozed, visibleSettled],
  );

  const shelves = useMemo(
    () => ({
      working: { expanded: workingExpanded, toggle: toggleWorking },
      snoozed: { expanded: snoozedExpanded, toggle: toggleSnoozed },
      settled: { expanded: settledExpanded, toggle: toggleSettled },
    }),
    [
      workingExpanded,
      toggleWorking,
      snoozedExpanded,
      toggleSnoozed,
      settledExpanded,
      toggleSettled,
    ],
  );

  return {
    sections,
    shelves,
    visibleWorking,
    visibleSnoozed,
    visibleSettled,
    settledVisibleCount,
    hiddenSettledCount,
    showMoreSettled,
    settledPageCount: SETTLED_TAIL_PAGE_COUNT,
    orderedThreads,
  };
}

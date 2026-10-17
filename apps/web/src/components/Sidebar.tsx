import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  type AnimateLayoutChanges,
  defaultAnimateLayoutChanges,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { OrderKeyAssignment } from "@playstead/client-runtime/state/threadOrder";
import {
  canSnooze,
  resolveSnoozePresets,
  snoozeWakeLabel,
} from "@playstead/client-runtime/state/threadSettled";
import type { ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useClientSettings } from "../clientSettings.ts";
import { openCommandPalette } from "../commandPaletteBus.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { useThreadSearch } from "../connection/useThreadSearch.ts";
import { createDraft } from "../drafts.ts";
import { useBulkThreadMenu } from "../hooks/useBulkThreadMenu.ts";
import { useThreadActionMenu } from "../hooks/useThreadActionMenu.ts";
import {
  pinThread,
  reorderActiveThread,
  reorderPinnedThread,
  settleThread,
  snoozeThread,
  unpinThread,
  unsettleThread,
  unsnoozeThread,
} from "../hooks/useThreadActions.ts";
import { readLocalApi } from "../localApi.ts";
import { registerSettleAndAdvance } from "../settleAndAdvance.ts";
import {
  clearThreadSelection,
  rangeSelectThreadsTo,
  readThreadSelection,
  setThreadSelectionAnchor,
  toggleThreadSelection,
  useThreadSelection,
} from "../threadSelection.ts";
import { failureToast } from "../toast.ts";
import {
  openProject,
  readActiveProjectId,
  setSidebarProjectScopeKey,
  useSidebarProjectScopeKey,
} from "../uiState.ts";
import { requestCustomSnooze } from "./CustomSnoozeDialog.tsx";
import {
  AlarmClockOffIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  ClockIcon,
  FolderIcon,
  FolderPlusIcon,
  ListFilterIcon,
  PinIcon,
  PinOffIcon,
  SettingsIcon,
  SquarePenIcon,
  Undo2Icon,
} from "./icons.tsx";
import { isModClick } from "./LegacySidebar.tsx";
import {
  createSidebarCollisionDetection,
  createSidebarSortingStrategy,
  restrictBelowSidebarLabel,
} from "./Sidebar.drag.ts";
import {
  buildSidebarListItems,
  planSidebarThreadDrop,
  resolveSidebarDropTarget,
  resolveSidebarDropVerb,
  resolveSidebarSweepKeys,
  type SidebarDropVerb,
  type SidebarListItem,
  sidebarListItemId,
  type SidebarListMarker,
  type SidebarListSection,
  sidebarMarkerId,
  sidebarThreadKeyAtY,
} from "./Sidebar.drag.logic.ts";
import { createSidebarListMotion } from "./Sidebar.motion.ts";
import { SidebarDragLifecycle, SidebarPointerSensor } from "./Sidebar.pointer.ts";
import {
  buildSidebarProjectGroups,
  buildSidebarSections,
  compactTimeLabel,
  createInboxReturnTracker,
  resolveSidebarProjectScope,
  type SidebarProjectGroup,
  type SidebarSection,
  snoozeMenuChildren,
  threadAfterPark,
} from "./Sidebar.inbox.logic.ts";
import {
  isTrailingDoubleClick,
  moveSearchHighlight,
  searchSidebarThreads,
} from "./Sidebar.logic.ts";
import {
  SEARCH_RESULTS_ID,
  SidebarSearchField,
  SidebarSearchResultRow,
  searchResultId,
} from "./sidebar/SidebarThreadSearch.tsx";
import { ThreadStatusIndicator, useThreadRename } from "./sidebar/SidebarThreadParts.tsx";

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

/** How far a press moves before it becomes a drag, so a click still opens the thread. */
const SIDEBAR_DRAG_DISTANCE = 6;
/** The Pinned and Active labels' height while dragging, at the root font size. */
const SIDEBAR_DRAG_LABEL_HEIGHT = 24;

type SidebarSweepAction = "settle" | "unsettle" | "unsnooze";

/**
 * A drop on its way to the server: the dropped thread and every thread
 * that takes a new key show as they will be, until the server's threads
 * catch up or a command fails (T3 Code's `optimisticDrop`).
 */
interface OptimisticDrop {
  readonly key: string;
  readonly section: "pinned" | "active" | "settled";
  readonly occurredAt: string;
  readonly assignedKeys: ReadonlyMap<string, string>;
  readonly done: boolean;
}

/**
 * The thread as the drop leaves it (T3 Code's `applySidebarThreadDrop`):
 * settled drops its pin and keys; into Pinned or Active it is un-settled,
 * pinned or unpinned, and takes its new key; any drop wakes it.
 */
function applySidebarThreadDrop(
  thread: SidebarThread,
  section: OptimisticDrop["section"],
  now: string,
  orderKey?: string,
): SidebarThread {
  const wasSettled = thread.settledOverride === "settled";
  // Every drop leaves the thread awake: pin, settle and wake each clear a snooze.
  const awake = { ...thread, snoozedAt: null, snoozedUntil: null };
  if (section === "settled") {
    return {
      ...awake,
      pinnedAt: null,
      pinOrderKey: null,
      activeOrderKey: null,
      settledOverride: "settled",
      settledAt: wasSettled ? (thread.settledAt ?? now) : now,
      unsettledAt: null,
    };
  }
  const resumed = wasSettled
    ? { ...awake, settledOverride: "active" as const, settledAt: null, unsettledAt: now }
    : awake;
  return {
    ...resumed,
    pinnedAt: section === "pinned" ? (thread.pinnedAt ?? now) : null,
    pinOrderKey: section === "pinned" ? (orderKey ?? thread.pinOrderKey) : null,
    ...(section === "active" && orderKey !== undefined ? { activeOrderKey: orderKey } : {}),
  };
}

/** The threads with a drop applied: the dropped one moved, the others with their new keys. */
function applyOptimisticDrop(
  threads: ReadonlyArray<SidebarThread>,
  drop: OptimisticDrop | null,
): ReadonlyArray<SidebarThread> {
  if (drop === null) return threads;
  return threads.map((thread) => {
    const orderKey = drop.assignedKeys.get(thread.id);
    if (thread.id === drop.key) {
      return applySidebarThreadDrop(thread, drop.section, drop.occurredAt, orderKey);
    }
    if (orderKey === undefined) return thread;
    return drop.section === "pinned"
      ? { ...thread, pinOrderKey: orderKey }
      : { ...thread, activeOrderKey: orderKey };
  });
}

/** Whether the server's threads now show the drop, so its projection can go. */
function dropLanded(
  threads: ReadonlyArray<SidebarThread>,
  projected: ReadonlyArray<SidebarThread>,
  drop: OptimisticDrop,
): boolean {
  const byId = new Map(threads.map((thread) => [thread.id as string, thread]));
  return projected.every((thread) => {
    if (thread.id !== drop.key && !drop.assignedKeys.has(thread.id)) return true;
    const canonical = byId.get(thread.id);
    return (
      canonical === undefined ||
      ((canonical.pinnedAt === null) === (thread.pinnedAt === null) &&
        canonical.settledOverride === thread.settledOverride &&
        canonical.pinOrderKey === thread.pinOrderKey &&
        canonical.activeOrderKey === thread.activeOrderKey &&
        canonical.snoozedUntil === thread.snoozedUntil)
    );
  });
}

// The list motion handles ordinary section changes; while sorting, dnd-kit's
// transforms move the rows, and replaying the drop would animate it twice.
const animateSidebarLayoutChanges: AnimateLayoutChanges = (args) =>
  args.isSorting ? defaultAnimateLayoutChanges(args) : false;

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

/**
 * The inbox sidebar, Playstead's default (T3 Code's `apps/web/src/components/Sidebar.tsx`
 * at 2577baf). One flat list in sections: **Pinned** on top, then **Active**,
 * the optional **Working** shelf (beta, **Settings → General**), and the
 * **Snoozed** and **Settled** shelves, folded by default. The header scopes
 * it to one project (or the "No project" group), adds a project and starts
 * a thread. Rows show their status, snooze, settle, un-settle or wake from
 * hover buttons, unpin from the pin, rename on double-click and open the
 * thread menu on right-click. Mod-click and shift-click select several rows
 * for the bulk menu. Unpin, settle, snooze and archive show **Undo** below
 * it (`AppSidebarLayout`). A snoozed thread leaves Snoozed when its time
 * comes, with no event: the sidebar sets a timer for the earliest wake.
 * **Search threads** in the header replaces the list with the threads whose
 * title or messages hold the query, chosen with the arrow keys and Enter.
 *
 * Rows drag within Pinned and Active to reorder them, and between sections
 * to pin, unpin, settle, un-settle or wake (out of Snoozed only), showing
 * what the drop will do; pressed and dragged, a row's Settle, Un-settle or
 * Wake button acts on every row it crosses.
 *
 * Seam for the slice's later tickets: **New thread in…** from the palette
 * (#42).
 */
export function Sidebar() {
  const state = usePrimaryConnectionState();
  const projects = useMemo(() => state?.shell?.projects ?? [], [state?.shell?.projects]);
  const threads = useMemo(() => state?.shell?.threads ?? [], [state?.shell?.threads]);
  const settings = useClientSettings();
  const workingShelfEnabled = settings.sidebarWorkingShelfEnabled;
  const { threadId: routeThreadId } = useParams({ strict: false });
  const navigate = useNavigate();

  const groups = useMemo(
    () =>
      buildSidebarProjectGroups({
        projects,
        threads,
        sortOrder: settings.sidebarProjectSortOrder,
      }),
    [projects, threads, settings.sidebarProjectSortOrder],
  );
  const scopeKey = useSidebarProjectScopeKey();
  const scopedGroup = resolveSidebarProjectScope(groups, scopeKey);
  const scopedProjectIds = useMemo(
    () => (scopedGroup === null ? null : new Set<string>(scopedGroup.projectIds)),
    [scopedGroup],
  );
  useEffect(() => clearThreadSelection(), [scopeKey]);

  const [optimisticDrop, setOptimisticDrop] = useState<OptimisticDrop | null>(null);
  const projectedThreads = useMemo(
    () => applyOptimisticDrop(threads, optimisticDrop),
    [threads, optimisticDrop],
  );
  useEffect(() => {
    if (optimisticDrop?.done && dropLanded(threads, projectedThreads, optimisticDrop)) {
      setOptimisticDrop(null);
    }
  }, [optimisticDrop, threads, projectedThreads]);

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

  // A folded shelf still shows the thread in view.
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
  const orderedIds = useMemo(() => orderedThreads.map((thread) => thread.id), [orderedThreads]);
  const orderedIdsRef = useRef(orderedIds);
  orderedIdsRef.current = orderedIds;
  // Settled and snoozed threads are parked: the view does not move to them.
  const parkedIdsRef = useRef(new Set<string>());
  parkedIdsRef.current = new Set(
    [...sections.settled, ...sections.snoozed].map((thread) => thread.id),
  );
  const routeThreadIdRef = useRef(routeThreadId);
  routeThreadIdRef.current = routeThreadId;

  /**
   * Where the view goes once the thread in it is parked (T3 Code's
   * `planForwardNavigation`): the next thread not settled or snoozed, or a
   * new draft in its project; nothing when the thread is not in view.
   * `coParking` are parked with it.
   */
  const planForwardNavigation = useCallback(
    (thread: Pick<SidebarThread, "id" | "projectId">, coParking?: ReadonlySet<string>) => {
      if (routeThreadIdRef.current !== thread.id) return () => undefined;
      const next = threadAfterPark({
        orderedIds: orderedIdsRef.current,
        parkedIds: parkedIdsRef.current,
        threadId: thread.id,
        ...(coParking === undefined ? {} : { coParkingIds: coParking }),
      });
      return () => {
        if (routeThreadIdRef.current !== thread.id) return;
        void (next === null
          ? navigate({
              to: "/draft/$draftId",
              params: { draftId: createDraft(thread.projectId) },
            })
          : navigate({ to: "/threads/$threadId", params: { threadId: next as ThreadId } }));
      };
    },
    [navigate],
  );

  /**
   * Settles a thread; settling the one in view moves the view on (T3 Code's
   * `attemptSettle`). `coSettling` are settled with it. Resolves with
   * whether it settled; a failure shows its notice.
   */
  const attemptSettle = useCallback(
    (
      thread: Pick<SidebarThread, "id" | "projectId" | "pinnedAt" | "pinOrderKey" | "snoozedUntil">,
      coSettling?: ReadonlySet<string>,
    ): Promise<boolean> => {
      const moveOn = planForwardNavigation(thread, coSettling);
      return settleThread(thread).then(
        () => {
          moveOn();
          return true;
        },
        (error: unknown) => {
          failureToast("Failed to settle thread", error);
          return false;
        },
      );
    },
    [planForwardNavigation],
  );

  /**
   * Snoozes a thread until `snoozedUntil`; snoozing the one in view moves the
   * view on, as settling does (T3 Code's `performSnooze`). Resolves with the
   * failure, if any, for the caller to report.
   */
  const performSnooze = useCallback(
    async (
      thread: SidebarThread,
      snoozedUntil: string,
      coSnoozing?: ReadonlySet<string>,
    ): Promise<{ readonly error: unknown } | null> => {
      const moveOn = planForwardNavigation(thread, coSnoozing);
      try {
        await snoozeThread(thread, snoozedUntil);
      } catch (error) {
        return { error };
      }
      moveOn();
      return null;
    },
    [planForwardNavigation],
  );
  const attemptSnooze = useCallback(
    (thread: SidebarThread, snoozedUntil: string) => {
      void performSnooze(thread, snoozedUntil).then((failure) => {
        if (failure !== null) failureToast("Failed to snooze thread", failure.error);
      });
    },
    [performSnooze],
  );
  /** Snoozes the selected threads together (T3 Code's bulk **Snooze**), with one notice for failures. */
  const snoozeThreads = useCallback(
    (targets: ReadonlyArray<SidebarThread>, snoozedUntil: string) => {
      const coSnoozing = new Set<string>(targets.map((thread) => thread.id));
      void Promise.all(
        targets.map((thread) => performSnooze(thread, snoozedUntil, coSnoozing)),
      ).then((outcomes) => {
        const failures = outcomes.filter((outcome) => outcome !== null);
        if (failures.length === 0) return;
        failureToast(
          failures.length < targets.length
            ? `Failed to snooze ${failures.length} thread${failures.length === 1 ? "" : "s"}`
            : "Failed to snooze threads",
          failures[0]!.error,
        );
      });
    },
    [performSnooze],
  );
  const threadsById = useMemo(
    () => new Map(threads.map((thread) => [thread.id as string, thread])),
    [threads],
  );
  const threadsByIdRef = useRef(threadsById);
  threadsByIdRef.current = threadsById;
  useEffect(
    () =>
      registerSettleAndAdvance((target) => {
        const thread = threadsByIdRef.current.get(target.id);
        if (thread !== undefined) void attemptSettle(thread);
      }),
    [attemptSettle],
  );
  const settleThreads = useCallback(
    (targets: ReadonlyArray<SidebarThread>) => {
      const coSettling = new Set<string>(targets.map((thread) => thread.id));
      for (const thread of targets) void attemptSettle(thread, coSettling);
    },
    [attemptSettle],
  );
  const openBulkMenu = useBulkThreadMenu({
    variant: "inbox",
    threads: orderedThreads,
    settleThreads,
    snoozeThreads,
  });

  // ---- Dragging (T3 Code's `Sidebar.tsx` DndContext, at 2577baf) ----

  const sidebarListItems = useMemo(
    () =>
      buildSidebarListItems({
        pinned: sections.pinned.map((thread) => thread.id),
        active: sections.active.map((thread) => thread.id),
        working: visibleWorking.map((thread) => thread.id),
        snoozed: visibleSnoozed.map((thread) => thread.id),
        settled: visibleSettled.map((thread) => thread.id),
        hasWorking: sections.working.length > 0,
        hasSnoozed: sections.snoozed.length > 0,
      }),
    [
      sections.pinned,
      sections.active,
      sections.working.length,
      sections.snoozed.length,
      visibleWorking,
      visibleSnoozed,
      visibleSettled,
    ],
  );
  const sortableIds = useMemo(() => sidebarListItems.map(sidebarListItemId), [sidebarListItems]);
  const sectionById = useMemo(() => {
    const map = new Map<string, SidebarListSection>();
    for (const item of sidebarListItems)
      if (item.kind === "thread") map.set(item.key, item.section);
    for (const thread of sections.working) map.set(thread.id, "working");
    for (const thread of sections.settled) map.set(thread.id, "settled");
    for (const thread of sections.snoozed) map.set(thread.id, "snoozed");
    return map;
  }, [sidebarListItems, sections.working, sections.settled, sections.snoozed]);
  const sectionByIdRef = useRef(sectionById);
  sectionByIdRef.current = sectionById;
  const projectedById = useMemo(
    () => new Map(projectedThreads.map((thread) => [thread.id as string, thread])),
    [projectedThreads],
  );

  const threadListRef = useRef<HTMLUListElement | null>(null);
  const listMotionRef = useRef<ReturnType<typeof createSidebarListMotion> | null>(null);
  const attachThreadList = useCallback((node: HTMLUListElement | null) => {
    threadListRef.current = node;
    listMotionRef.current?.dispose();
    listMotionRef.current = node === null ? null : createSidebarListMotion(node);
    listMotionRef.current?.update(false);
  }, []);
  const dragLabelOffsetRef = useRef(0);
  const restrictBelowPins = useCallback<Modifier>(
    (args) => restrictBelowSidebarLabel(args, dragLabelOffsetRef.current),
    [],
  );

  const [dragState, setDragState] = useState<{
    readonly activeKey: string;
    readonly activeSection: SidebarListSection;
    readonly occurredAt: string;
    readonly activationY: number | null;
    readonly targetSection: SidebarListSection | null;
  } | null>(null);
  const dragTargetSection = dragState?.targetSection ?? null;
  const dragSensorRef = useRef<SidebarPointerSensor | null>(null);
  const finishThreadDrag = useCallback((started: boolean) => {
    dragSensorRef.current = null;
    if (started) {
      listMotionRef.current?.release();
      setDragState(null);
    }
  }, []);
  const attachDragSensor = useCallback((sensor: SidebarPointerSensor) => {
    dragSensorRef.current = sensor;
  }, []);
  const cancelThreadDrag = useCallback(() => dragSensorRef.current?.cancel(), []);
  const dndSensors = useSensors(
    useSensor(SidebarPointerSensor, {
      distance: SIDEBAR_DRAG_DISTANCE,
      onAttach: attachDragSensor,
      onFinish: finishThreadDrag,
    }),
  );
  // A dragged thread that leaves the list (deleted, archived) ends the drag.
  useEffect(() => {
    if (
      dragState !== null &&
      !sidebarListItems.some((item) => item.kind === "thread" && item.key === dragState.activeKey)
    ) {
      cancelThreadDrag();
    }
  }, [cancelThreadDrag, dragState, sidebarListItems]);

  // Rows move only when the order or a row's section changes; keying the
  // motion on that keeps other updates from reading the layout.
  const listOrderKey = useMemo(
    () =>
      sidebarListItems
        .map((item) => (item.kind === "thread" ? `${item.key}:${item.section}` : item.marker))
        .join("\0"),
    [sidebarListItems],
  );
  const listMotionPaused = dragState !== null;
  useLayoutEffect(() => {
    void listOrderKey;
    listMotionRef.current?.update(!listMotionPaused);
  }, [listMotionPaused, listOrderKey]);

  const pinnedOrder = useMemo(() => sections.pinned.map((thread) => thread.id), [sections.pinned]);
  const activeOrder = useMemo(() => sections.active.map((thread) => thread.id), [sections.active]);
  const { pinnedKeysById, activeKeysById } = useMemo(
    () => ({
      pinnedKeysById: new Map<string, string | null>(
        threads.map((thread) => [thread.id, thread.pinOrderKey]),
      ),
      activeKeysById: new Map<string, string | null>(
        threads.map((thread) => [thread.id, thread.activeOrderKey]),
      ),
    }),
    [threads],
  );
  const planDrop = useCallback(
    (activeKey: string, activeSection: SidebarListSection, overId: string) => {
      const target = resolveSidebarDropTarget(sidebarListItems, activeKey, overId);
      const source = threadsById.get(activeKey);
      if (target === null || source === undefined) return null;
      return {
        target,
        plan: planSidebarThreadDrop({
          activeKey,
          activeSection,
          activePinned: source.pinnedAt !== null,
          activeSettled: source.settledOverride === "settled",
          target,
          pinnedOrder,
          pinnedKeysById,
          activeOrder,
          activeKeysById,
          activeTimeOrdered: workingShelfEnabled,
        }),
      };
    },
    [
      sidebarListItems,
      threadsById,
      pinnedOrder,
      pinnedKeysById,
      activeOrder,
      activeKeysById,
      workingShelfEnabled,
    ],
  );

  const handleThreadDragStart = useCallback(
    (event: DragStartEvent) => {
      const activeKey = String(event.active.id);
      const activeSection = sectionById.get(activeKey);
      if (activeSection === undefined) return;
      listMotionRef.current?.suspend();
      const list = threadListRef.current;
      const header = list?.querySelector<HTMLElement>(
        `[data-sidebar-marker="${sidebarMarkerId("pinned-header")}"]`,
      );
      if (list && header) {
        const listRect = list.getBoundingClientRect();
        const scale = list.offsetWidth > 0 ? listRect.width / list.offsetWidth : 1;
        dragLabelOffsetRef.current =
          header.getBoundingClientRect().top - listRect.top + SIDEBAR_DRAG_LABEL_HEIGHT * scale;
      } else {
        dragLabelOffsetRef.current = 0;
      }
      setDragState({
        activeKey,
        activeSection,
        targetSection: activeSection,
        occurredAt: new Date().toISOString(),
        activationY:
          event.activatorEvent instanceof PointerEvent ? event.activatorEvent.clientY : null,
      });
    },
    [sectionById],
  );
  const handleThreadDragOver = useCallback(
    (event: DragOverEvent) => {
      const target = event.over
        ? resolveSidebarDropTarget(sidebarListItems, String(event.active.id), String(event.over.id))
        : null;
      setDragState((current) =>
        current === null || current.activeKey !== String(event.active.id)
          ? current
          : { ...current, targetSection: target?.section ?? null },
      );
    },
    [sidebarListItems],
  );

  // Settled shows the dragged thread as just settled, so newest; with the
  // Working shelf on, Active shows it at the time it would come back.
  const draggedSettledOrder = useMemo(() => {
    if (dragState === null) return [];
    const settledIds = sections.settled.map((thread) => thread.id as string);
    return dragState.activeSection === "settled"
      ? settledIds
      : [dragState.activeKey, ...settledIds.filter((id) => id !== dragState.activeKey)];
  }, [dragState, sections.settled]);
  const draggedActiveOrder = useMemo(() => {
    if (!workingShelfEnabled || dragState === null) return undefined;
    const projected = threads.map((thread) =>
      thread.id === dragState.activeKey
        ? applySidebarThreadDrop(thread, "active", dragState.occurredAt)
        : thread,
    );
    return buildSidebarSections({
      threads: projected,
      scopedProjectIds,
      workingShelfEnabled,
      returnedAt: inboxReturns.returnedAt,
    }).active.map((thread) => thread.id as string);
  }, [dragState, threads, scopedProjectIds, workingShelfEnabled]);
  const sortingStrategy = useMemo(
    () =>
      createSidebarSortingStrategy({
        items: sidebarListItems,
        boundaryLabelHeight: SIDEBAR_DRAG_LABEL_HEIGHT,
        settledOrder: draggedSettledOrder,
        ...(draggedActiveOrder === undefined ? {} : { activeOrder: draggedActiveOrder }),
        settledExpanded,
        settledVisibleCount,
        routeThreadKey: routeThreadId ?? null,
        snoozedThreadCount: sections.snoozed.length,
      }),
    [
      sidebarListItems,
      draggedSettledOrder,
      draggedActiveOrder,
      settledExpanded,
      settledVisibleCount,
      routeThreadId,
      sections.snoozed.length,
    ],
  );
  const draggedKey = dragState?.activeKey;
  const draggedFrom = dragState?.activeSection;
  const dragActivationY = dragState?.activationY ?? null;
  const collisionDetection = useMemo(() => {
    if (draggedKey === undefined || draggedFrom === undefined) {
      return createSidebarCollisionDetection(() => true);
    }
    return createSidebarCollisionDetection(
      (id) => {
        const planned = planDrop(draggedKey, draggedFrom, id);
        return planned !== null && planned.plan.kind !== "none";
      },
      { items: sidebarListItems, activationY: dragActivationY },
    );
  }, [draggedKey, draggedFrom, dragActivationY, planDrop, sidebarListItems]);

  const handleThreadDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeKey = String(event.active.id);
      const activeSection = sectionById.get(activeKey);
      const thread = threadsById.get(activeKey);
      if (event.over === null || activeSection === undefined || thread === undefined) return;
      const planned = planDrop(activeKey, activeSection, String(event.over.id));
      if (planned === null || planned.plan.kind === "none") return;
      const { plan, target } = planned;
      const assignments: ReadonlyArray<OrderKeyAssignment> =
        plan.kind === "pin"
          ? [
              ...(plan.orderKey === undefined ? [] : [{ id: activeKey, orderKey: plan.orderKey }]),
              ...plan.extraAssignments,
            ]
          : plan.kind === "settle"
            ? []
            : plan.assignments;
      const drop: OptimisticDrop = {
        key: activeKey,
        section: target.section,
        occurredAt: new Date().toISOString(),
        assignedKeys: new Map(assignments.map(({ id, orderKey }) => [id, orderKey])),
        done: false,
      };
      setOptimisticDrop(drop);
      const run = async (operation: Promise<unknown>, title: string): Promise<boolean> => {
        try {
          await operation;
          return true;
        } catch (error) {
          failureToast(title, error);
          return false;
        }
      };
      void (async () => {
        let landed = true;
        switch (plan.kind) {
          case "settle":
            landed = await attemptSettle(thread);
            break;
          case "move-active":
            landed =
              (!plan.unpin || (await run(unpinThread(thread), "Failed to unpin thread"))) &&
              (!plan.unsettle ||
                (await run(unsettleThread(thread.id), "Failed to un-settle thread"))) &&
              (!plan.unsnooze || (await run(unsnoozeThread(thread.id), "Failed to wake thread")));
            break;
          case "pin":
            landed = await run(pinThread(thread.id, plan.orderKey), "Failed to pin thread");
            break;
          case "reorder-pinned":
            break;
        }
        if (landed && plan.kind !== "settle") {
          const writes = plan.kind === "pin" ? plan.extraAssignments : plan.assignments;
          for (const { id, orderKey } of writes) {
            landed =
              plan.kind === "move-active"
                ? await run(
                    reorderActiveThread(id as ThreadId, orderKey),
                    "Failed to reorder active threads",
                  )
                : await run(
                    reorderPinnedThread(id as ThreadId, orderKey),
                    "Failed to reorder pinned threads",
                  );
            if (!landed) break;
          }
        }
        setOptimisticDrop((current) =>
          current === drop ? (landed ? { ...drop, done: true } : null) : current,
        );
      })();
    },
    [attemptSettle, planDrop, sectionById, threadsById],
  );

  // ---- Press-and-drag Settle / Un-settle across rows (T3 Code's `startActionSweep`) ----

  const [actionSweep, setActionSweep] = useState<{
    readonly action: SidebarSweepAction;
    readonly keys: ReadonlySet<string>;
  } | null>(null);
  const startActionSweep = useCallback(
    (thread: SidebarThread, action: SidebarSweepAction, event: PointerEvent) => {
      const originSection = sectionByIdRef.current.get(thread.id);
      const canApply = (key: string) =>
        threadsByIdRef.current.has(key) && sectionByIdRef.current.get(key) === originSection;
      let targetKey: string | null = null;
      let swept: string[] = [];
      const sweepTo = (key: string | null) => {
        if (key === null || key === targetKey) return;
        targetKey = key;
        swept = resolveSidebarSweepKeys(orderedIdsRef.current, thread.id, key, canApply);
        setActionSweep({ action, keys: new Set(swept) });
      };
      dragSensorRef.current = new SidebarPointerSensor({
        active: thread.id,
        event,
        options: {
          distance: SIDEBAR_DRAG_DISTANCE,
          onAttach: () => {},
          onFinish: () => {
            dragSensorRef.current = null;
            setActionSweep(null);
          },
        },
        onPending: () => {},
        onStart: () => sweepTo(thread.id),
        onMove: ({ y }) =>
          sweepTo(threadListRef.current && sidebarThreadKeyAtY(threadListRef.current, y)),
        onEnd: () => {
          const targets = swept
            .filter(canApply)
            .flatMap((key) => threadsByIdRef.current.get(key) ?? []);
          if (action === "settle") settleThreads(targets);
          else if (action === "unsettle") {
            for (const target of targets) {
              unsettleThread(target.id).catch((error: unknown) =>
                failureToast("Failed to un-settle thread", error),
              );
            }
          } else {
            for (const target of targets) {
              unsnoozeThread(target.id).catch((error: unknown) =>
                failureToast("Failed to wake thread", error),
              );
            }
          }
        },
        onCancel: () => {},
        onAbort: () => {},
      });
    },
    [settleThreads],
  );

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const isSearching = searchQuery.trim().length > 0;
  const threadSearch = useThreadSearch(searchQuery);
  const searchMatchById = useMemo(
    () => new Map(threadSearch.matches.map((match) => [match.threadId as string, match])),
    [threadSearch.matches],
  );
  // Every thread in scope, folded shelves included, in the sidebar's order.
  const searchResults = useMemo(
    () =>
      searchSidebarThreads(
        [
          ...sections.pinned,
          ...sections.active,
          ...sections.working,
          ...sections.snoozed,
          ...sections.settled,
        ],
        searchQuery,
        new Set(searchMatchById.keys()),
      ),
    [sections, searchQuery, searchMatchById],
  );
  const searchResultOrder = searchResults.map((thread) => thread.id).join(" ");
  useEffect(() => setActiveResultIndex(0), [searchResultOrder]);
  useEffect(() => {
    if (!isSearching) return;
    document
      .getElementById(searchResultId(activeResultIndex))
      ?.scrollIntoView({ block: "nearest" });
  }, [activeResultIndex, isSearching, searchResultOrder]);
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setActiveResultIndex(0);
  }, []);
  const selectSearchResult = (thread: SidebarThread) => {
    clearSearch();
    openProject(thread.projectId);
    void navigate({ to: "/threads/$threadId", params: { threadId: thread.id } });
  };
  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && isSearching) {
      event.preventDefault();
      // The layout's Escape would clear the selection too.
      event.stopPropagation();
      clearSearch();
      return;
    }
    if (searchResults.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? "down" : "up";
      setActiveResultIndex((index) => moveSearchHighlight(index, searchResults.length, direction));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = searchResults[activeResultIndex];
      if (result !== undefined) selectSearchResult(result);
    }
  };

  const startNewThread = () => {
    // T3 Code opens **New thread in…** with several projects unless Shift
    // is held; until the palette has that mode (#42), it starts in the
    // current project: the thread in view's or the last opened, while the
    // scope shows it; otherwise the scope's, or the first project.
    const routeThread = routeThreadId === undefined ? undefined : threadsById.get(routeThreadId);
    const inScope = (projectId: string | undefined) =>
      projectId !== undefined && (scopedProjectIds === null || scopedProjectIds.has(projectId));
    const current = [routeThread?.projectId, readActiveProjectId()].find(inScope) as
      | ProjectId
      | undefined;
    const projectId = current ?? scopedGroup?.projectIds[0] ?? groups[0]?.projectIds[0];
    if (projectId === undefined) return;
    openProject(projectId);
    void navigate({ to: "/draft/$draftId", params: { draftId: createDraft(projectId) } });
  };

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id as string, project.title])),
    [projects],
  );
  const draggingFrom = dragState?.activeSection ?? null;
  const renderRow = (thread: SidebarThread, section: SidebarListSection) => (
    <SortableThreadRow
      key={thread.id}
      id={thread.id}
      // Working follows live status, so its rows stay put; so does every
      // row while a drop is on its way.
      disabled={section === "working" || optimisticDrop !== null}
    >
      {(sortable) => (
        <InboxThreadRow
          thread={thread}
          section={section}
          current={thread.id === routeThreadId}
          projectName={
            scopedGroup === null ? (projectNameById.get(thread.projectId) ?? null) : null
          }
          orderedIdsRef={orderedIdsRef}
          sortable={sortable}
          dropVerb={
            dragState?.activeKey === thread.id
              ? resolveSidebarDropVerb(dragState.activeSection, dragTargetSection)
              : null
          }
          dragOverPinned={dragState?.activeKey === thread.id && dragTargetSection === "pinned"}
          sweepAction={actionSweep?.keys.has(thread.id) ? actionSweep.action : null}
          onSettle={attemptSettle}
          onSnooze={attemptSnooze}
          onActionSweepStart={startActionSweep}
          onBulkMenu={openBulkMenu}
        />
      )}
    </SortableThreadRow>
  );
  const firstShelf =
    sections.working.length > 0
      ? "working-header"
      : sections.snoozed.length > 0
        ? "snoozed-header"
        : "settled-header";
  const renderMarker = (marker: SidebarListMarker): ReactNode => {
    switch (marker) {
      case "pinned-header":
      case "pinned-divider":
        return (
          <SidebarDragBoundary
            key={marker}
            marker={marker}
            label={marker === "pinned-header" ? "Pinned" : "Active"}
            visible={draggingFrom !== null}
            isDropTarget={dragTargetSection === (marker === "pinned-header" ? "pinned" : "active")}
          />
        );
      case "active-placeholder":
        return (
          <SidebarSectionPlaceholder
            key={marker}
            marker={marker}
            label="Active"
            showHint={
              draggingFrom !== null &&
              (sections.active.length === 0 ||
                (draggingFrom === "active" &&
                  sections.active.length === 1 &&
                  dragTargetSection !== null &&
                  dragTargetSection !== "active"))
            }
            isDropTarget={dragTargetSection === "active"}
          />
        );
      case "settled-placeholder":
        return (
          <SidebarSectionPlaceholder
            key={marker}
            marker={marker}
            label="Settled"
            showHint={
              draggingFrom !== null &&
              (visibleSettled.length === 0 ||
                (draggingFrom === "settled" &&
                  visibleSettled.length === 1 &&
                  dragTargetSection !== null &&
                  dragTargetSection !== "settled"))
            }
            isDropTarget={dragTargetSection === "settled"}
          />
        );
      case "working-header":
        return (
          <ShelfHeader
            key={marker}
            marker={marker}
            className={firstShelf === marker ? "mt-auto" : undefined}
            label={workingExpanded ? "Working" : `Working (${sections.working.length})`}
            expanded={workingExpanded}
            onToggle={toggleWorking}
          />
        );
      case "snoozed-header":
        return (
          <ShelfHeader
            key={marker}
            marker={marker}
            className={firstShelf === marker ? "mt-auto" : undefined}
            label={snoozedExpanded ? "Snoozed" : `Snoozed (${sections.snoozed.length})`}
            expanded={snoozedExpanded}
            onToggle={toggleSnoozed}
            tone="info"
            dragging={draggingFrom !== null}
          />
        );
      case "settled-header":
        return (
          <ShelfHeader
            key={marker}
            marker={marker}
            className={firstShelf === marker ? "mt-auto" : undefined}
            label={settledExpanded ? "Settled" : `Settled (${sections.settled.length})`}
            expanded={settledExpanded}
            onToggle={toggleSettled}
            dragging={draggingFrom !== null}
            isDropTarget={dragTargetSection === "settled"}
          />
        );
    }
  };
  const renderListItem = (item: SidebarListItem): ReactNode => {
    if (item.kind === "marker") return renderMarker(item.marker);
    const thread = projectedById.get(item.key);
    return thread === undefined ? null : renderRow(thread, item.section);
  };

  const total =
    sections.pinned.length +
    sections.active.length +
    sections.working.length +
    sections.snoozed.length +
    sections.settled.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-2 pb-1">
        <SidebarSearchField
          inputRef={searchInputRef}
          query={searchQuery}
          onQueryChange={(value) => {
            setSearchQuery(value);
            setActiveResultIndex(0);
          }}
          onKeyDown={onSearchKeyDown}
          isSearching={isSearching}
          resultCount={searchResults.length}
          activeIndex={activeResultIndex}
          onClear={clearSearch}
        />
        {groups.length > 0 ? (
          <>
            <ProjectScopeMenu groups={groups} scopedGroup={scopedGroup} />
            <HeaderButton
              label="Add project"
              onClick={() => openCommandPalette({ open: "add-project" })}
            >
              <FolderPlusIcon className="size-4" />
            </HeaderButton>
          </>
        ) : null}
        <HeaderButton label="New thread" disabled={projects.length === 0} onClick={startNewThread}>
          <SquarePenIcon className="size-4" />
        </HeaderButton>
      </div>
      <nav aria-label="Threads" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        {isSearching ? (
          searchResults.length > 0 ? (
            <ul
              id={SEARCH_RESULTS_ID}
              role="listbox"
              aria-label="Thread search results"
              className="flex flex-col gap-px"
            >
              {searchResults.map((thread, index) => (
                <SidebarSearchResultRow
                  key={thread.id}
                  thread={thread}
                  index={index}
                  isSettled={thread.settledOverride === "settled"}
                  isHighlighted={index === activeResultIndex}
                  isCurrent={thread.id === routeThreadId}
                  projectName={
                    scopedGroup === null ? (projectNameById.get(thread.projectId) ?? null) : null
                  }
                  match={searchMatchById.get(thread.id) ?? null}
                  query={searchQuery}
                  onHighlight={() => setActiveResultIndex(index)}
                  onSelect={() => selectSearchResult(thread)}
                />
              ))}
            </ul>
          ) : (
            <p
              role="status"
              className="px-2 py-6 text-center text-xs text-neutral-500 dark:text-neutral-400"
            >
              {threadSearch.isPending ? "Searching thread messages…" : "No threads found"}
            </p>
          )
        ) : total === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-neutral-500 dark:text-neutral-400">
            {projects.length === 0 ? (
              <>
                <span>No projects yet</span>
                <button
                  type="button"
                  onClick={() => openCommandPalette({ open: "add-project" })}
                  className="rounded-md border border-neutral-300 px-2.5 py-1 font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
                >
                  Add project
                </button>
              </>
            ) : scopedGroup !== null ? (
              `No threads in ${scopedGroup.displayName} yet`
            ) : (
              "No threads yet"
            )}
          </div>
        ) : (
          <DndContext
            sensors={dndSensors}
            collisionDetection={collisionDetection}
            modifiers={[
              restrictToVerticalAxis,
              restrictBelowPins,
              restrictToFirstScrollableAncestor,
            ]}
            onDragStart={handleThreadDragStart}
            onDragOver={handleThreadDragOver}
            onDragEnd={handleThreadDragEnd}
          >
            <SidebarDragLifecycle onUnmount={cancelThreadDrag} />
            <SortableContext items={sortableIds} strategy={sortingStrategy}>
              <ul
                ref={attachThreadList}
                // A presentational list keeps assistive technology reading
                // the rows in order (T3 Code's VoiceOver note).
                role="presentation"
                className={`relative flex flex-1 flex-col gap-px${
                  actionSweep === null ? "" : " **:pointer-events-none"
                }`}
              >
                {sidebarListItems.map(renderListItem)}
                {settledExpanded && hiddenSettledCount > 0 ? (
                  <li className="list-none">
                    <button
                      type="button"
                      onClick={() =>
                        setSettledVisibleCount((count) => count + SETTLED_TAIL_PAGE_COUNT)
                      }
                      className="w-full rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
                    >
                      Show {Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT)} more
                    </button>
                  </li>
                ) : null}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </nav>
    </div>
  );
}

function HeaderButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="rounded p-1.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
    >
      {props.children}
    </button>
  );
}

type SortableBag = Pick<
  ReturnType<typeof useSortable>,
  "listeners" | "setNodeRef" | "transform" | "transition" | "isDragging"
>;

/** A thread row the sidebar can drag (T3 Code's `SortableThreadRow`). */
function SortableThreadRow(props: {
  readonly id: string;
  readonly disabled: boolean;
  readonly children: (sortable: SortableBag) => ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
    disabled: { draggable: props.disabled },
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  const bag = useMemo(
    () => ({ listeners, setNodeRef, transform, transition, isDragging }),
    [listeners, setNodeRef, transform, transition, isDragging],
  );
  return props.children(bag);
}

/** A row between sections: it slides with the rows but is never dragged (T3 Code's `SortableSidebarMarker`). */
function SortableSidebarMarker(props: {
  readonly marker: SidebarListMarker;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  const { setNodeRef, transform, transition } = useSortable({
    id: sidebarMarkerId(props.marker),
    disabled: { draggable: true },
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  return (
    <li
      ref={setNodeRef}
      data-sidebar-marker={sidebarMarkerId(props.marker)}
      className={`list-none ${props.className ?? ""}`}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: props.marker.endsWith("-placeholder") ? "none" : transition,
        visibility: transform?.scaleY === 0 ? "hidden" : undefined,
      }}
    >
      {props.children}
    </li>
  );
}

/**
 * The Pinned and Active labels, shown only while dragging; they take no
 * room until then (T3 Code's `SidebarDragBoundary`).
 */
function SidebarDragBoundary(props: {
  readonly marker: "pinned-header" | "pinned-divider";
  readonly label: string;
  readonly visible: boolean;
  readonly isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      className="pointer-events-none relative mx-0.5 -mb-px h-0"
    >
      {props.visible ? (
        <div className="sidebar-drag-boundary-label absolute inset-x-2 top-1 flex h-4 items-center gap-2">
          <span
            className={`shrink-0 text-xs font-medium ${
              props.isDropTarget ? "text-sky-600 dark:text-sky-400" : "text-neutral-500"
            }`}
          >
            {props.label}
          </span>
          <span
            aria-hidden
            className={`h-px flex-1 ${
              props.isDropTarget ? "bg-sky-500/50" : "bg-neutral-400/40 dark:bg-neutral-600/50"
            }`}
          />
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

/** Somewhere to drop into an empty Active or Settled (T3 Code's `SidebarSectionPlaceholder`). */
function SidebarSectionPlaceholder(props: {
  readonly marker: "active-placeholder" | "settled-placeholder";
  readonly label: string;
  readonly showHint: boolean;
  readonly isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker marker={props.marker} className="relative mx-0.5 -mb-px h-0">
      {props.showHint ? (
        <div
          className={`absolute inset-x-0 top-0 flex h-9 items-center justify-center rounded-md border border-dashed text-xs ${
            props.isDropTarget
              ? "border-sky-500/50 bg-sky-500/5 text-sky-600 dark:text-sky-400"
              : "border-neutral-400/40 text-neutral-500"
          }`}
        >
          {props.label}
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

/**
 * A shelf's header, which folds and unfolds it (T3 Code's
 * `SidebarSectionHeader`). While dragging it stands out, and takes the
 * accent colour when the drop would land in its shelf.
 */
function ShelfHeader(props: {
  readonly marker: "working-header" | "snoozed-header" | "settled-header";
  readonly label: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly className?: string | undefined;
  readonly dragging?: boolean;
  readonly isDropTarget?: boolean;
  /** Snoozed's header is tinted, as T3 Code's "info" tone. */
  readonly tone?: "muted" | "info";
}) {
  const tone = props.isDropTarget
    ? "text-sky-600 dark:text-sky-400"
    : props.dragging
      ? "text-neutral-900 dark:text-neutral-100"
      : props.tone === "info"
        ? "text-sky-700 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-200"
        : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100";
  return (
    <SortableSidebarMarker marker={props.marker} className={`h-8 ${props.className ?? ""}`}>
      <button
        type="button"
        aria-expanded={props.expanded}
        onClick={props.onToggle}
        className={`flex h-8 w-full items-center gap-1 rounded-md px-2 text-xs font-medium ${tone}`}
      >
        <ChevronRightIcon
          className={`size-3 transition-transform motion-reduce:transition-none ${props.expanded ? "rotate-90" : ""}`}
        />
        {props.label}
      </button>
    </SortableSidebarMarker>
  );
}

/** What the dragged row says its drop will do (T3 Code's `dropVerbBadge`). */
const DROP_VERB_BADGE: Record<SidebarDropVerb, ReactNode> = {
  pin: (
    <>
      <PinIcon className="size-3" />
      Pin
    </>
  ),
  unpin: (
    <>
      <PinOffIcon className="size-3" />
      Unpin
    </>
  ),
  settle: (
    <>
      <CircleCheckIcon className="size-3" />
      Settle
    </>
  ),
  unsettle: (
    <>
      <Undo2Icon className="size-3" />
      Un-settle
    </>
  ),
  wake: (
    <>
      <AlarmClockOffIcon className="size-3" />
      Wake
    </>
  ),
};

/**
 * The project scope menu (T3 Code's `Combobox` in the sidebar header):
 * **All projects** or one group, with **Search projects...** to narrow it.
 */
function ProjectScopeMenu(props: {
  readonly groups: ReadonlyArray<SidebarProjectGroup>;
  readonly scopedGroup: SidebarProjectGroup | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const items = [
    { key: null, label: "All projects" },
    ...props.groups.map((group) => ({ key: group.key, label: group.displayName })),
  ];
  const trimmed = query.trim().toLowerCase();
  const shown =
    trimmed.length === 0
      ? items
      : items.filter((item) => item.key !== null && item.label.toLowerCase().includes(trimmed));
  const choose = (key: string | null) => {
    setSidebarProjectScopeKey(key);
    setOpen(false);
    setQuery("");
  };
  const navigate = useNavigate();
  // T3 Code's `openProjectSettings`: the gear, or right-click, on a project.
  const openProjectSettings = (group: SidebarProjectGroup) => {
    setOpen(false);
    setQuery("");
    void navigate({ to: "/projects/$projectKey", params: { projectKey: group.key } });
  };

  return (
    <div ref={rootRef} className="relative">
      <HeaderButton
        label={
          props.scopedGroup === null
            ? "Filter threads by project"
            : `Filter threads by project: ${props.scopedGroup.displayName}`
        }
        onClick={() => {
          setOpen((value) => !value);
          setQuery("");
        }}
      >
        {props.scopedGroup === null ? (
          <ListFilterIcon className="size-4" />
        ) : (
          <FolderIcon className="size-4 text-sky-600 dark:text-sky-400" />
        )}
      </HeaderButton>
      {open ? (
        <div className="absolute top-full right-0 z-20 mt-1 w-60 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <input
            autoFocus
            aria-label="Search projects"
            placeholder="Search projects..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              } else if (event.key === "Enter" && shown[0] !== undefined) {
                event.preventDefault();
                choose(shown[0].key);
              }
            }}
            className="mb-1 w-full rounded-md bg-neutral-100 px-2 py-1 text-sm outline-none dark:bg-neutral-800"
          />
          {shown.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-neutral-500">No matching projects.</div>
          ) : (
            <ul role="listbox" aria-label="Projects">
              {shown.map((item) => {
                const selected = (props.scopedGroup?.key ?? null) === item.key;
                const group =
                  item.key === null
                    ? undefined
                    : props.groups.find((candidate) => candidate.key === item.key);
                return (
                  <li
                    key={item.key ?? "all"}
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(item.key)}
                    onContextMenu={(event) => {
                      if (group === undefined) return;
                      event.preventDefault();
                      openProjectSettings(group);
                    }}
                    className={`group/scope flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                      selected ? "font-medium" : ""
                    }`}
                  >
                    <FolderIcon className="size-4 shrink-0 text-neutral-500" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {group === undefined ? null : (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-hidden="true"
                        title={`Project settings for ${group.displayName}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          openProjectSettings(group);
                        }}
                        className="ml-auto rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-900 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                      >
                        <SettingsIcon className="size-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A row (T3 Code's `SidebarThreadRow`): a card in Pinned, Active and
 * Working, a slim row in Snoozed and Settled. A card's hover buttons snooze
 * it (presets and **Custom…**) and settle it; a snoozed row shows the time
 * left and wakes from its hover button, a settled one un-settles. Pressed
 * and dragged across rows, Settle, Un-settle and Wake act on each. A pinned
 * row's pin unpins it. Dragged, the row shows what the drop will do instead
 * of its status and hover buttons.
 */
function InboxThreadRow(props: {
  readonly thread: SidebarThread;
  readonly section: SidebarSection;
  readonly current: boolean;
  /** Shown when the sidebar spans several projects. */
  readonly projectName: string | null;
  readonly orderedIdsRef: { readonly current: ReadonlyArray<string> };
  readonly sortable: SortableBag;
  readonly dropVerb: SidebarDropVerb | null;
  readonly dragOverPinned: boolean;
  readonly sweepAction: SidebarSweepAction | null;
  readonly onSettle: (thread: SidebarThread) => void;
  readonly onSnooze: (thread: SidebarThread, snoozedUntil: string) => void;
  readonly onActionSweepStart: (
    thread: SidebarThread,
    action: SidebarSweepAction,
    event: PointerEvent,
  ) => void;
  readonly onBulkMenu: (position: { x: number; y: number }) => void;
}) {
  const { thread, section, current, onSnooze, sortable } = props;
  const rename = useThreadRename(thread);
  const { openMenu } = useThreadActionMenu(thread, {
    onStartRename: rename.start,
    projectFilter: true,
    onSnooze: useCallback(
      (snoozedUntil: string) => onSnooze(thread, snoozedUntil),
      [onSnooze, thread],
    ),
  });
  const selected = useThreadSelection().selectedThreadIds.has(thread.id);
  const settled = section === "settled";
  const snoozed = section === "snoozed";
  const slim = settled || snoozed;
  const pinned = thread.pinnedAt !== null;
  const dragging = sortable.isDragging;
  const sweeping = props.sweepAction !== null;
  const now = Date.now();
  const timeLabel =
    snoozed && thread.snoozedUntil !== null
      ? snoozeWakeLabel(thread.snoozedUntil, { now: new Date(now).toISOString() })
      : compactTimeLabel(
          settled
            ? (thread.settledAt ?? thread.updatedAt)
            : (thread.latestRunRequestedAt ?? thread.updatedAt),
          now,
        );
  const showSnoozeButton = !slim && !dragging && !sweeping && canSnooze(thread);

  /** The snooze button's menu: the presets and **Custom…**, below the button. */
  const openSnoozeMenu = (button: HTMLElement) => {
    const presets = resolveSnoozePresets(new Date());
    const box = button.getBoundingClientRect();
    void (async () => {
      const chosen = await readLocalApi()
        .contextMenu.show(snoozeMenuChildren(presets), { x: box.left, y: box.bottom })
        .catch(() => null);
      if (chosen === null) return;
      const choice =
        chosen === "snooze:custom"
          ? await requestCustomSnooze()
          : presets.find((preset) => `snooze:${preset.id}` === chosen);
      if (choice != null) onSnooze(thread, choice.snoozedUntil);
    })();
  };

  const surface = dragging
    ? "bg-neutral-200 shadow-lg dark:bg-neutral-800"
    : current
      ? "bg-neutral-200 dark:bg-neutral-800"
      : selected || sweeping
        ? "bg-sky-100 dark:bg-sky-950"
        : "hover:bg-neutral-100 dark:hover:bg-neutral-900";
  const rowClass = `group relative flex w-full items-center gap-2 rounded-md px-2.5 text-left text-sm ${
    slim ? "h-8 text-neutral-500 dark:text-neutral-400" : "min-h-9 py-1.5"
  } ${surface}`;
  const sortableProps = {
    ref: sortable.setNodeRef,
    style: {
      transform: CSS.Translate.toString(sortable.transform),
      transition: sortable.transition,
      // A row the projected layout folds away hides; the dragged row never does.
      visibility: !dragging && sortable.transform?.scaleY === 0 ? ("hidden" as const) : undefined,
    },
  };

  if (rename.input !== null) {
    return (
      <li {...sortableProps} className="list-none">
        <div className={rowClass}>
          <ThreadStatusIndicator thread={thread} />
          {rename.input}
        </div>
      </li>
    );
  }

  // Dragged, a pin stays only while the row is over Pinned without a badge.
  const showPin = pinned && (!dragging || (props.dragOverPinned && props.dropVerb === null));
  const badgeVerb: SidebarDropVerb | null = dragging
    ? props.dropVerb
    : props.sweepAction === "unsnooze"
      ? "wake"
      : props.sweepAction;
  const badge =
    badgeVerb === null ? null : (
      <span
        role="status"
        className="pointer-events-none ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-sky-500/40 bg-sky-500/10 px-1.5 text-[11px] font-medium text-sky-700 dark:text-sky-300"
      >
        {DROP_VERB_BADGE[badgeVerb]}
      </span>
    );
  const startSweep = (event: ReactPointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    // The sweep, not the row's drag, takes this press.
    event.stopPropagation();
    props.onActionSweepStart(
      thread,
      snoozed ? "unsnooze" : settled ? "unsettle" : "settle",
      event.nativeEvent,
    );
  };
  const hoverButtonClass =
    "pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1.5 text-neutral-500 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100";

  return (
    <li
      {...sortableProps}
      {...sortable.listeners}
      className={`group relative list-none${dragging ? " z-20" : ""}`}
    >
      <Link
        to="/threads/$threadId"
        params={{ threadId: thread.id }}
        draggable={false}
        data-thread-item={thread.id}
        aria-current={current ? "page" : undefined}
        aria-selected={selected || undefined}
        onClick={(event) => {
          if (isModClick(event)) {
            event.preventDefault();
            toggleThreadSelection(thread.id);
            return;
          }
          if (event.shiftKey) {
            event.preventDefault();
            rangeSelectThreadsTo(thread.id, props.orderedIdsRef.current);
            return;
          }
          if (isTrailingDoubleClick(event.detail)) {
            event.preventDefault();
            return;
          }
          clearThreadSelection();
          setThreadSelectionAnchor(thread.id);
          openProject(thread.projectId);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          rename.start();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          const position = { x: event.clientX, y: event.clientY };
          if (readThreadSelection().selectedThreadIds.has(thread.id)) {
            props.onBulkMenu(position);
            return;
          }
          clearThreadSelection();
          openMenu(position);
        }}
        className={`${rowClass} ${
          dragging || sweeping ? "" : showSnoozeButton ? "pr-16" : "pr-9"
        } select-none`}
      >
        {dragging ? null : <ThreadStatusIndicator thread={thread} />}
        <span className="flex min-w-0 flex-1 flex-col">
          {/* Dimmed while a provider writes the title (T3 Code's `opacity-55`). */}
          <span
            className={`truncate${thread.titleRegeneration === null ? "" : " opacity-55"}`}
            title={thread.title}
            aria-busy={thread.titleRegeneration === null ? undefined : true}
          >
            {thread.title}
          </span>
          {props.projectName !== null && !slim ? (
            <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {props.projectName}
            </span>
          ) : null}
        </span>
        {showPin && dragging ? (
          <PinIcon className="size-3 shrink-0 text-neutral-400" />
        ) : showPin ? (
          <span className="size-3 shrink-0" aria-hidden />
        ) : null}
        {badge ?? (
          <span
            className={`shrink-0 text-xs tabular-nums group-hover:opacity-0 ${
              snoozed ? "text-sky-700 dark:text-sky-400" : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            {timeLabel}
          </span>
        )}
      </Link>
      {showPin && !dragging ? (
        <button
          type="button"
          aria-label="Unpin thread"
          title="Unpin thread"
          onClick={() =>
            unpinThread(thread).catch((error: unknown) =>
              failureToast("Failed to unpin thread", error),
            )
          }
          className="group/unpin absolute top-1/2 right-9 -translate-y-1/2 rounded-sm text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          <PinIcon className="size-3 group-hover/unpin:hidden" />
          <PinOffIcon className="hidden size-3 group-hover/unpin:block" />
        </button>
      ) : null}
      {showSnoozeButton ? (
        <button
          type="button"
          aria-label="Snooze thread"
          title="Snooze thread"
          aria-haspopup="menu"
          onClick={(event) => openSnoozeMenu(event.currentTarget)}
          className="pointer-events-none absolute top-1/2 right-8 -translate-y-1/2 rounded-md p-1.5 text-neutral-500 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <ClockIcon className="size-3.5" />
        </button>
      ) : null}
      {dragging || sweeping ? null : snoozed ? (
        <button
          type="button"
          aria-label="Wake thread now"
          title="Wake thread now"
          onPointerDown={startSweep}
          onClick={() =>
            unsnoozeThread(thread.id).catch((error: unknown) =>
              failureToast("Failed to wake thread", error),
            )
          }
          className={hoverButtonClass}
        >
          <AlarmClockOffIcon className="size-3.5" />
        </button>
      ) : settled ? (
        <button
          type="button"
          aria-label="Un-settle thread"
          title="Un-settle thread"
          onPointerDown={startSweep}
          onClick={() =>
            unsettleThread(thread.id).catch((error: unknown) =>
              failureToast("Failed to un-settle thread", error),
            )
          }
          className={hoverButtonClass}
        >
          <Undo2Icon className="size-3.5" />
        </button>
      ) : (
        <button
          type="button"
          aria-label="Settle thread"
          title="Settle thread"
          onPointerDown={startSweep}
          onClick={() => props.onSettle(thread)}
          className={hoverButtonClass}
        >
          <CheckIcon className="size-3.5" />
        </button>
      )}
    </li>
  );
}

import {
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import type { OrderKeyAssignment } from "@playstead/client-runtime/state/threadSort";
import type { ThreadId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  createSidebarCollisionDetection,
  createSidebarSortingStrategy,
  restrictBelowSidebarLabel,
} from "../components/Sidebar.drag.ts";
import {
  applyOptimisticDrop,
  applySidebarThreadDrop,
  buildSidebarListItems,
  dropLanded,
  type OptimisticDrop,
  planSidebarThreadDrop,
  resolveSidebarDropTarget,
  resolveSidebarSweepKeys,
  sidebarListItemId,
  type SidebarListSection,
  sidebarMarkerId,
  sidebarThreadKeyAtY,
} from "../components/Sidebar.drag.logic.ts";
import { buildSidebarSections } from "../components/Sidebar.logic.ts";
import { createSidebarListMotion } from "../components/Sidebar.motion.ts";
import { SidebarPointerSensor } from "../components/Sidebar.pointer.ts";
import type { SidebarSweepAction } from "../components/sidebar/SidebarInboxThreadRow.tsx";
import { failureToast } from "../components/ui/toast.tsx";
import { inboxReturnedAt, type SidebarSectionsView } from "./useSidebarSections.ts";
import {
  pinThread,
  reorderActiveThread,
  reorderPinnedThread,
  unpinThread,
  unsettleThread,
  unsnoozeThread,
} from "./useThreadActions.ts";

type SidebarThread = OrchestrationV2ThreadShell;

/** How far a press moves before it becomes a drag, so a click still opens the thread. */
const SIDEBAR_DRAG_DISTANCE = 6;
/** The Pinned and Active labels' height while dragging, at the root font size. */
const SIDEBAR_DRAG_LABEL_HEIGHT = 24;

/**
 * A drop on its way to the server (T3 Code's `optimisticDrop`): the threads
 * show as the drop leaves them until the server's threads catch up, or a
 * command fails.
 */
export function useOptimisticDrop(threads: ReadonlyArray<SidebarThread>) {
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
  return { projectedThreads, dropPending: optimisticDrop !== null, setOptimisticDrop };
}

export interface SidebarDragState {
  readonly activeKey: string;
  readonly activeSection: SidebarListSection;
  readonly occurredAt: string;
  readonly activationY: number | null;
  readonly targetSection: SidebarListSection | null;
}

/**
 * Dragging rows in the inbox (T3 Code's `Sidebar.tsx` DndContext at
 * 2577baf): the flat list dnd-kit sorts, its sensors, collision detection
 * and sorting strategy, what each drop sends to the server, the list's
 * motion, and the press-and-drag sweep from a row's Settle, Un-settle or
 * Wake button (T3 Code's `startActionSweep`).
 */
export function useSidebarThreadDrag(input: {
  readonly threads: ReadonlyArray<SidebarThread>;
  readonly threadsById: ReadonlyMap<string, SidebarThread>;
  readonly view: SidebarSectionsView;
  readonly scopedProjectIds: ReadonlySet<string> | null;
  readonly workingShelfEnabled: boolean;
  readonly routeThreadId: string | undefined;
  readonly setOptimisticDrop: (
    update: (current: OptimisticDrop | null) => OptimisticDrop | null,
  ) => void;
  readonly attemptSettle: (thread: SidebarThread) => Promise<boolean>;
  readonly settleThreads: (threads: ReadonlyArray<SidebarThread>) => void;
}) {
  const { threads, threadsById, view, scopedProjectIds, workingShelfEnabled, routeThreadId } =
    input;
  const { sections, visibleWorking, visibleSnoozed, visibleSettled } = view;
  const { setOptimisticDrop, attemptSettle, settleThreads } = input;

  const listItems = useMemo(
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
  const sortableIds = useMemo(() => listItems.map(sidebarListItemId), [listItems]);
  const sectionById = useMemo(() => {
    const map = new Map<string, SidebarListSection>();
    for (const item of listItems) if (item.kind === "thread") map.set(item.key, item.section);
    for (const thread of sections.working) map.set(thread.id, "working");
    for (const thread of sections.settled) map.set(thread.id, "settled");
    for (const thread of sections.snoozed) map.set(thread.id, "snoozed");
    return map;
  }, [listItems, sections.working, sections.settled, sections.snoozed]);

  // Read by the sweep's pointer callbacks, which outlive a render.
  const latest = useRef({ sectionById, threadsById, orderedIds: [] as ReadonlyArray<string> });
  latest.current = {
    sectionById,
    threadsById,
    orderedIds: view.orderedThreads.map((thread) => thread.id),
  };

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
  const modifiers = useMemo(
    () => [restrictToVerticalAxis, restrictBelowPins, restrictToFirstScrollableAncestor],
    [restrictBelowPins],
  );

  const [dragState, setDragState] = useState<SidebarDragState | null>(null);
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
  const sensors = useSensors(
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
      !listItems.some((item) => item.kind === "thread" && item.key === dragState.activeKey)
    ) {
      cancelThreadDrag();
    }
  }, [cancelThreadDrag, dragState, listItems]);

  // Rows move only when the order or a row's section changes; keying the
  // motion on that keeps other updates from reading the layout.
  const listOrderKey = useMemo(
    () =>
      listItems
        .map((item) => (item.kind === "thread" ? `${item.key}:${item.section}` : item.marker))
        .join("\0"),
    [listItems],
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
      const target = resolveSidebarDropTarget(listItems, activeKey, overId);
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
      listItems,
      threadsById,
      pinnedOrder,
      pinnedKeysById,
      activeOrder,
      activeKeysById,
      workingShelfEnabled,
    ],
  );

  const onDragStart = useCallback(
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
  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const target = event.over
        ? resolveSidebarDropTarget(listItems, String(event.active.id), String(event.over.id))
        : null;
      setDragState((current) =>
        current === null || current.activeKey !== String(event.active.id)
          ? current
          : { ...current, targetSection: target?.section ?? null },
      );
    },
    [listItems],
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
      returnedAt: inboxReturnedAt,
    }).active.map((thread) => thread.id as string);
  }, [dragState, threads, scopedProjectIds, workingShelfEnabled]);
  const settledExpanded = view.shelves.settled.expanded;
  const { settledVisibleCount } = view;
  const snoozedCount = sections.snoozed.length;
  const sortingStrategy = useMemo(
    () =>
      createSidebarSortingStrategy({
        items: listItems,
        boundaryLabelHeight: SIDEBAR_DRAG_LABEL_HEIGHT,
        settledOrder: draggedSettledOrder,
        ...(draggedActiveOrder === undefined ? {} : { activeOrder: draggedActiveOrder }),
        settledExpanded,
        settledVisibleCount,
        routeThreadKey: routeThreadId ?? null,
        snoozedThreadCount: snoozedCount,
      }),
    [
      listItems,
      draggedSettledOrder,
      draggedActiveOrder,
      settledExpanded,
      settledVisibleCount,
      routeThreadId,
      snoozedCount,
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
      { items: listItems, activationY: dragActivationY },
    );
  }, [draggedKey, draggedFrom, dragActivationY, planDrop, listItems]);

  const onDragEnd = useCallback(
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
      setOptimisticDrop(() => drop);
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
    [attemptSettle, planDrop, sectionById, threadsById, setOptimisticDrop],
  );

  const [actionSweep, setActionSweep] = useState<{
    readonly action: SidebarSweepAction;
    readonly keys: ReadonlySet<string>;
  } | null>(null);
  const startActionSweep = useCallback(
    (thread: SidebarThread, action: SidebarSweepAction, event: PointerEvent) => {
      const originSection = latest.current.sectionById.get(thread.id);
      const canApply = (key: string) =>
        latest.current.threadsById.has(key) &&
        latest.current.sectionById.get(key) === originSection;
      let targetKey: string | null = null;
      let swept: string[] = [];
      const sweepTo = (key: string | null) => {
        if (key === null || key === targetKey) return;
        targetKey = key;
        swept = resolveSidebarSweepKeys(latest.current.orderedIds, thread.id, key, canApply);
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
            .flatMap((key) => latest.current.threadsById.get(key) ?? []);
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

  return {
    listItems,
    sortableIds,
    attachThreadList,
    cancelThreadDrag,
    dragState,
    actionSweep,
    startActionSweep,
    dndContextProps: {
      sensors,
      collisionDetection,
      modifiers,
      onDragStart,
      onDragOver,
      onDragEnd,
    },
    sortingStrategy,
  };
}

export type SidebarThreadDrag = ReturnType<typeof useSidebarThreadDrag>;

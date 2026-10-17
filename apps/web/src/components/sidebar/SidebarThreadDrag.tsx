import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { planThreadReorder } from "@playstead/client-runtime/state/threadSort";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  pinThread,
  unpinThread,
  unsettleThread,
  unsnoozeThread,
  reorderThread,
} from "../../hooks/useThreadActions.ts";
import { failureToast } from "../../toast.ts";
import { planThreadDrop, settleSweep, threadDropOrder } from "../Sidebar.drag.ts";
import type { SidebarSection, SidebarSections } from "../Sidebar.inbox.logic.ts";

type Thread = OrchestrationV2ThreadShell;
const canSettle = (thread: Thread) => !["starting", "running", "waiting"].includes(thread.status);

export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

const DragState = createContext({
  dragging: false,
  target: null as SidebarSection | null,
  reduced: false,
});

/** Each gesture is decided again against the latest shell on release. The
 * server remains the authority if a run starts or a row changes mid-drag. */
export function SidebarThreadDrag(props: {
  sections: SidebarSections;
  allThreads: ReadonlyArray<Thread>;
  visibleThreads: ReadonlyArray<Thread>;
  workingShelfEnabled: boolean;
  onSettle: (thread: Thread) => void;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const rows = Object.values(props.sections).flat();
  const source = rows.find((t) => t.id === dragId);
  const sectionOf = (id: string): SidebarSection | undefined =>
    (Object.keys(props.sections) as SidebarSection[]).find((section) =>
      props.sections[section].some((t) => t.id === id),
    );
  const destination = (id: string | null) =>
    id?.startsWith("shelf:")
      ? (id.slice(6) as SidebarSection)
      : id === null
        ? undefined
        : sectionOf(id);
  const target = destination(overId);
  const from = dragId === null ? undefined : sectionOf(dragId);
  const plan =
    source && from && target
      ? planThreadDrop({
          from,
          to: target,
          workingShelfEnabled: props.workingShelfEnabled,
          pinned: source.pinnedAt !== null,
          settled: source.settledOverride === "settled",
          canSettle: canSettle(source),
        })
      : null;
  const finish = async (event: DragEndEvent) => {
    setDragId(null);
    setOverId(null);
    const id = String(event.active.id);
    const thread = rows.find((t) => t.id === id);
    const origin = sectionOf(id);
    const over = event.over === null ? null : String(event.over.id);
    const to = destination(over);
    if (!thread || !origin || !to || over === id) return;
    const drop = planThreadDrop({
      from: origin,
      to,
      workingShelfEnabled: props.workingShelfEnabled,
      pinned: thread.pinnedAt !== null,
      settled: thread.settledOverride === "settled",
      canSettle: canSettle(thread),
    });
    if (!drop) return;
    const order = threadDropOrder(
      props.sections[to].map((t) => t.id),
      id,
      over?.startsWith("shelf:") ? null : over,
    );
    if (order === null && drop.actions.length === 0) return;
    const field = drop.reorder === "pinned" ? "pinOrderKey" : "activeOrderKey";
    const assignments =
      drop.reorder === null || order === null
        ? []
        : planThreadReorder(order, new Map(props.allThreads.map((t) => [t.id, t[field]])), id);
    for (const action of drop.actions) {
      if (action === "pin")
        await pinThread(thread.id, assignments.find((a) => a.id === id)?.orderKey);
      if (action === "unpin") await unpinThread(thread);
      if (action === "unsettle") await unsettleThread(thread.id);
      if (action === "wake") await unsnoozeThread(thread.id);
      if (action === "settle") props.onSettle(thread);
    }
    if (drop.reorder !== null) {
      for (const assignment of assignments) {
        const row = props.allThreads.find((t) => t.id === assignment.id);
        if (row) await reorderThread(row.id, drop.reorder, assignment.orderKey);
      }
    }
  };
  const over = (event: DragOverEvent) =>
    setOverId(event.over === null ? null : String(event.over.id));
  return (
    <DragState.Provider
      value={{ dragging: dragId !== null, target: plan ? (target ?? null) : null, reduced }}
    >
      <DndContext
        sensors={sensors}
        modifiers={[restrictToVerticalAxis]}
        collisionDetection={(args) =>
          args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)
        }
        onDragStart={(event) => {
          setDragId(String(event.active.id));
          setOverId(String(event.active.id));
        }}
        onDragOver={over}
        onDragCancel={() => {
          setDragId(null);
          setOverId(null);
        }}
        onDragEnd={(event) => {
          void finish(event).catch((error) => failureToast("Failed to move thread", error));
        }}
      >
        <SortableContext
          items={props.visibleThreads.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {props.children}
        </SortableContext>
        <DragOverlay
          {...(reduced ? { transition: "none" } : {})}
          dropAnimation={reduced ? null : { duration: 150, easing: "ease-out" }}
        >
          {source ? (
            <div className="rounded-md border border-sky-500 bg-white px-3 py-2 text-sm shadow-lg dark:bg-neutral-900">
              <span className="block truncate">{source.title}</span>
              {plan?.badge ? (
                <span
                  role="status"
                  className="mt-1 inline-block rounded bg-sky-100 px-1.5 text-xs text-sky-900"
                >
                  {plan.badge}
                </span>
              ) : null}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </DragState.Provider>
  );
}

export function useThreadDrag(id: string, section: SidebarSection, disabled: boolean) {
  const state = useContext(DragState);
  const sortable = useSortable({
    id,
    disabled,
    transition: state.reduced ? null : { duration: 150, easing: "ease" },
  });
  return {
    ...sortable,
    style: {
      transform:
        state.reduced || state.target !== section
          ? undefined
          : CSS.Transform.toString(sortable.transform),
      transition: state.reduced ? undefined : sortable.transition,
      opacity: sortable.isDragging ? 0.25 : 1,
    },
  };
}

export function ThreadDropBoundary(props: {
  section: "pinned" | "active" | "settled";
  children?: ReactNode;
}) {
  const state = useContext(DragState);
  const { setNodeRef } = useDroppable({ id: `shelf:${props.section}` });
  const label = props.section === "pinned" ? "Pinned" : "Active";
  return (
    <div
      ref={setNodeRef}
      data-drop-shelf={props.section}
      className={
        state.dragging
          ? `h-8 rounded ${props.children ? "" : "px-2 py-1"} text-xs ${state.target === props.section ? "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100" : "text-neutral-500"}`
          : props.children
            ? ""
            : "h-8"
      }
    >
      {props.children ?? (state.dragging ? label : null)}
    </div>
  );
}

/** Defer the sweep until release so removing rows cannot move fresh rows
 * under a stationary pointer. Escape, blur, cancellation and unmount discard it. */
export function useSettleSweep(
  sections: SidebarSections,
  settle: (threads: ReadonlyArray<Thread>) => void,
) {
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const begin = (event: ReactPointerEvent, thread: Thread) => {
    if (event.button !== 0 || !canSettle(thread)) return;
    event.preventDefault();
    event.stopPropagation();
    cleanup.current?.();
    const order =
      (Object.values(sections) as ReadonlyArray<ReadonlyArray<Thread>>).find((rows) =>
        rows.some((row) => row.id === thread.id),
      ) ?? [];
    const ids = order.map((t) => t.id as string);
    let chosen = [thread.id as string];
    setMarked(new Set(chosen));
    const move = (e: PointerEvent) => {
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-sweep-thread]")?.dataset.sweepThread;
      if (!target) return;
      chosen = settleSweep(ids, thread.id, target, (id) => {
        const row = order.find((t) => t.id === id);
        return row !== undefined && row.settledOverride !== "settled" && canSettle(row);
      });
      setMarked(new Set(chosen));
    };
    const cancel = () => {
      cleanup.current?.();
      setMarked(new Set());
    };
    const up = () => {
      const targets = order.filter((t) => chosen.includes(t.id));
      cancel();
      settle(targets);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    cleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
      cleanup.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    window.addEventListener("blur", cancel, { once: true });
    window.addEventListener("keydown", key);
  };
  return { begin, marked };
}

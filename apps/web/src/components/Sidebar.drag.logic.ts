import {
  type OrderKeyAssignment,
  planThreadReorder,
} from "@playstead/client-runtime/state/threadOrder";

import type { SidebarSection } from "./Sidebar.inbox.logic.ts";

/**
 * Dragging threads in the inbox sidebar (T3 Code's drag functions in
 * `apps/web/src/components/Sidebar.logic.ts` at 2577baf): the flat list
 * the sortable context sees, where a dragged thread would land, and what
 * the drop does. A drag within Pinned or Active reorders it; into Pinned
 * pins at that place; out of Pinned unpins; onto Settled settles; out of
 * Settled un-settles; out of Snoozed wakes. Nothing drops into Snoozed,
 * which needs a wake time, or into Working, which follows live status.
 */

/** A section of the drag list: the inbox's sections and **Snoozed** (#38). */
export type SidebarListSection = SidebarSection | "snoozed";

const MARKER_PREFIX = "sidebar-marker-";

/**
 * The rows between sections. The Pinned and Active labels (header and
 * divider) show only while dragging; the placeholders give an empty
 * Active or Settled somewhere to drop.
 */
export type SidebarListMarker =
  | "pinned-header"
  | "pinned-divider"
  | "active-placeholder"
  | "working-header"
  | "snoozed-header"
  | "settled-header"
  | "settled-placeholder";

export const sidebarMarkerId = (marker: SidebarListMarker): string => `${MARKER_PREFIX}${marker}`;

export type SidebarListItem =
  | { readonly kind: "thread"; readonly key: string; readonly section: SidebarListSection }
  | { readonly kind: "marker"; readonly marker: SidebarListMarker };

export const sidebarListItemId = (item: SidebarListItem): string =>
  item.kind === "thread" ? item.key : sidebarMarkerId(item.marker);

const isShelfHeader = (item: SidebarListItem): boolean =>
  item.kind === "marker" &&
  (item.marker === "working-header" ||
    item.marker === "snoozed-header" ||
    item.marker === "settled-header");

/**
 * The drag list in the order the sidebar shows it (T3 Code's
 * `sidebarListItems`). The rows are the ones shown: a folded shelf lists
 * only the thread in view. Working and Snoozed get a header while they
 * have any thread, shown or folded.
 */
export function buildSidebarListItems(input: {
  readonly pinned: ReadonlyArray<string>;
  readonly active: ReadonlyArray<string>;
  readonly working: ReadonlyArray<string>;
  readonly snoozed: ReadonlyArray<string>;
  readonly settled: ReadonlyArray<string>;
  readonly hasWorking: boolean;
  readonly hasSnoozed: boolean;
}): ReadonlyArray<SidebarListItem> {
  const rows = (keys: ReadonlyArray<string>, section: SidebarListSection): SidebarListItem[] =>
    keys.map((key) => ({ kind: "thread", key, section }));
  const marker = (name: SidebarListMarker): SidebarListItem => ({ kind: "marker", marker: name });
  return [
    marker("pinned-header"),
    ...rows(input.pinned, "pinned"),
    marker("pinned-divider"),
    marker("active-placeholder"),
    ...rows(input.active, "active"),
    ...(input.hasWorking ? [marker("working-header"), ...rows(input.working, "working")] : []),
    ...(input.hasSnoozed ? [marker("snoozed-header"), ...rows(input.snoozed, "snoozed")] : []),
    marker("settled-header"),
    marker("settled-placeholder"),
    ...rows(input.settled, "settled"),
  ];
}

/** The section a row at `index` of the list is in, read from the markers above it. */
function sectionAtSlot(items: ReadonlyArray<SidebarListItem>, index: number): SidebarListSection {
  let section: SidebarListSection = "pinned";
  for (const item of items.slice(0, index)) {
    if (item.kind !== "marker") continue;
    if (item.marker === "pinned-divider") section = "active";
    else if (item.marker === "working-header") section = "working";
    else if (item.marker === "snoozed-header") section = "snoozed";
    else if (item.marker === "settled-header") section = "settled";
  }
  return section;
}

export interface SidebarDropTarget {
  readonly section: "pinned" | "active" | "settled";
  /** Pinned and Active as they would be after the drop. */
  readonly pinnedOrder: ReadonlyArray<string>;
  readonly activeOrder: ReadonlyArray<string>;
}

/**
 * Where the thread `activeKey` lands when dropped over `overId`: it takes
 * that row's place, and the markers above say which section that is. Null
 * for Working, Snoozed or a row that is not in the list.
 */
export function resolveSidebarDropTarget(
  items: ReadonlyArray<SidebarListItem>,
  activeKey: string,
  overId: string,
): SidebarDropTarget | null {
  const activeIndex = items.findIndex((item) => sidebarListItemId(item) === activeKey);
  const overIndex = items.findIndex((item) => sidebarListItemId(item) === overId);
  const dragged = items[activeIndex];
  if (overIndex === -1 || dragged?.kind !== "thread") return null;
  const moved = items.filter((_, index) => index !== activeIndex);
  moved.splice(overIndex, 0, dragged);
  const section = sectionAtSlot(moved, overIndex);
  if (section === "working" || section === "snoozed") return null;
  const pinnedOrder: string[] = [];
  const activeOrder: string[] = [];
  let current: "pinned" | "active" = "pinned";
  for (const item of moved) {
    if (isShelfHeader(item)) break;
    if (item.kind === "marker") {
      if (item.marker === "pinned-divider") current = "active";
    } else (current === "pinned" ? pinnedOrder : activeOrder).push(item.key);
  }
  return { section, pinnedOrder, activeOrder };
}

export type SidebarThreadDropPlan =
  | { readonly kind: "none" }
  | {
      readonly kind: "reorder-pinned";
      readonly order: ReadonlyArray<string>;
      readonly assignments: ReadonlyArray<OrderKeyAssignment>;
    }
  | {
      readonly kind: "pin";
      readonly order: ReadonlyArray<string>;
      /** The dragged thread's new pin key, sent with `thread.pin`. */
      readonly orderKey: string | undefined;
      /** Other pins that need new keys too. */
      readonly extraAssignments: ReadonlyArray<OrderKeyAssignment>;
    }
  | {
      readonly kind: "move-active";
      /** Null while the Working shelf orders Active by time. */
      readonly order: ReadonlyArray<string> | null;
      readonly assignments: ReadonlyArray<OrderKeyAssignment>;
      readonly unpin: boolean;
      readonly unsettle: boolean;
      readonly unsnooze: boolean;
    }
  | { readonly kind: "settle" };

const sameOrder = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && left.every((key, index) => key === right[index]);

/**
 * What dropping the thread on `target` does (T3 Code's
 * `planSidebarThreadDrop`). `pinnedOrder` and `activeOrder` are the
 * sections before the drop; the key maps hold every thread's key, shown or
 * not. With the Working shelf on, Active is ordered by time, so a thread
 * can move into it but not be placed.
 */
export function planSidebarThreadDrop(input: {
  readonly activeKey: string;
  readonly activeSection: SidebarListSection;
  readonly activePinned?: boolean;
  readonly activeSettled?: boolean;
  readonly target: SidebarDropTarget;
  readonly pinnedOrder: ReadonlyArray<string>;
  readonly pinnedKeysById: ReadonlyMap<string, string | null>;
  readonly activeOrder: ReadonlyArray<string>;
  readonly activeKeysById: ReadonlyMap<string, string | null>;
  readonly activeTimeOrdered: boolean;
}): SidebarThreadDropPlan {
  const { activeKey, activeSection, target } = input;
  const activePinned = input.activePinned ?? activeSection === "pinned";
  const activeSettled = input.activeSettled ?? activeSection === "settled";
  switch (target.section) {
    case "settled":
      return activeSection === "settled" ? { kind: "none" } : { kind: "settle" };
    case "active": {
      const lifecycle = {
        unpin: activePinned,
        unsettle: activeSettled,
        unsnooze: activeSection === "snoozed",
      };
      if (input.activeTimeOrdered) {
        return activeSection === "active"
          ? { kind: "none" }
          : { kind: "move-active", order: null, assignments: [], ...lifecycle };
      }
      if (activeSection === "active" && sameOrder(target.activeOrder, input.activeOrder)) {
        return { kind: "none" };
      }
      return {
        kind: "move-active",
        order: target.activeOrder,
        assignments: planThreadReorder({
          orderedIds: target.activeOrder,
          keysById: input.activeKeysById,
          movedId: activeKey,
        }),
        ...lifecycle,
      };
    }
    case "pinned": {
      if (activeSection === "pinned" && sameOrder(target.pinnedOrder, input.pinnedOrder)) {
        return { kind: "none" };
      }
      const assignments = planThreadReorder({
        orderedIds: target.pinnedOrder,
        keysById: input.pinnedKeysById,
        movedId: activeKey,
      });
      if (activeSection === "pinned") {
        return assignments.length === 0
          ? { kind: "none" }
          : { kind: "reorder-pinned", order: target.pinnedOrder, assignments };
      }
      return {
        kind: "pin",
        order: target.pinnedOrder,
        orderKey: assignments.find((assignment) => assignment.id === activeKey)?.orderKey,
        // A snoozed pin is already pinned, so its own key is written as a reorder.
        extraAssignments: activePinned
          ? assignments
          : assignments.filter((assignment) => assignment.id !== activeKey),
      };
    }
  }
}

export type SidebarDropVerb = "pin" | "unpin" | "settle" | "unsettle" | "wake";

/** The badge the dragged row shows once it is over another section (T3 Code's `resolveSidebarDropVerb`). */
export function resolveSidebarDropVerb(
  from: SidebarListSection,
  to: SidebarListSection | null,
): SidebarDropVerb | null {
  if (to === null || to === from || to === "working" || to === "snoozed") return null;
  if (to === "pinned") return "pin";
  if (to === "settled") return "settle";
  if (from === "pinned") return "unpin";
  if (from === "settled") return "unsettle";
  return "wake";
}

/**
 * The rows a press-and-drag on **Settle** covers (T3 Code's
 * `resolveSidebarSweepKeys`): every row from the pressed one to the one
 * under the pointer that `canApply` allows.
 */
export function resolveSidebarSweepKeys(
  orderedKeys: ReadonlyArray<string>,
  originKey: string,
  targetKey: string,
  canApply: (key: string) => boolean,
): string[] {
  const origin = orderedKeys.indexOf(originKey);
  const target = orderedKeys.indexOf(targetKey);
  if (origin === -1 || target === -1) return [];
  return orderedKeys.slice(Math.min(origin, target), Math.max(origin, target) + 1).filter(canApply);
}

/** The thread row at height `y` of the list, the nearest one above it (T3 Code's `sidebarThreadKeyAtY`). */
export function sidebarThreadKeyAtY(list: HTMLElement, y: number): string | null {
  let key: string | null = null;
  for (const row of list.querySelectorAll<HTMLElement>("[data-thread-item]")) {
    if (key !== null && row.getBoundingClientRect().top > y) break;
    key = row.dataset.threadItem ?? null;
  }
  return key;
}

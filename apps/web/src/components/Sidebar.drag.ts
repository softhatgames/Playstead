import { closestCenter, type CollisionDetection, type Modifier } from "@dnd-kit/core";
import type { SortingStrategy } from "@dnd-kit/sortable";

import {
  resolveSidebarDropTarget,
  type SidebarListItem,
  sidebarListItemId,
  type SidebarListMarker,
  type SidebarListSection,
  sidebarMarkerId,
} from "./Sidebar.drag.logic.ts";

/**
 * The inbox sidebar's dnd-kit pieces (T3 Code's
 * `apps/web/src/components/Sidebar.drag.ts` at 2577baf): the modifier that
 * keeps a lifted row below the Pinned label, the collision detection that
 * only offers drops that do something, and the sorting strategy that slides
 * the other rows to show where the thread will land in its new section.
 */

type Transform = ReturnType<SortingStrategy>;
type Layout = Parameters<SortingStrategy>[0];
type ThreadItem = Extract<SidebarListItem, { kind: "thread" }>;

const STATIONARY: NonNullable<Transform> = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
// A row that the projected layout leaves out (a folded shelf's) collapses.
const COLLAPSED: NonNullable<Transform> = { ...STATIONARY, scaleY: 0 };

/** The rows' heights at the root font size: cards, slim rows and shelf headers. */
const CARD_HEIGHT = 82;
const SLIM_HEIGHT = 36;
const HEADER_HEIGHT = 32;

const SHELF_HEADERS = ["working-header", "snoozed-header", "settled-header"] as const;

const isShelfHeader = (item: SidebarListItem | undefined): boolean =>
  item?.kind === "marker" &&
  (SHELF_HEADERS as ReadonlyArray<SidebarListMarker>).includes(item.marker);

const isCardSection = (section: SidebarListSection) =>
  section === "pinned" || section === "active" || section === "working";

/**
 * Keeps the lifted row from rising above the Pinned label, `offset` pixels
 * below the top of the list.
 */
export function restrictBelowSidebarLabel(
  { transform, containerNodeRect, draggingNodeRect }: Parameters<Modifier>[0],
  offset: number,
) {
  if (!containerNodeRect || !draggingNodeRect) return transform;
  const minimumY = containerNodeRect.top + offset - draggingNodeRect.top;
  return transform.y < minimumY ? { ...transform, y: minimumY } : transform;
}

/**
 * The nearest row's centre, as dnd-kit's `closestCenter`, but a row where
 * the drop would do nothing falls back to the dragged row itself. Over the
 * Pinned/Active divider the pointer's direction decides the side: moving up
 * picks a Pinned slot, moving down an Active one, so opening the gap does
 * not flip a still pointer back.
 */
export function createSidebarCollisionDetection(
  isValidTarget: (id: string) => boolean,
  options: {
    readonly items?: ReadonlyArray<SidebarListItem>;
    readonly activationY?: number | null;
  } = {},
): CollisionDetection {
  const validity = new Map<string, boolean>();
  const sectionOf = new Map<string, SidebarListSection | null>();
  let previousY = options.activationY ?? null;
  let side: "pinned" | "active" | undefined;
  return (args) => {
    let collisions = closestCenter(args);
    const pointer = args.pointerCoordinates;
    const items = options.items;
    const source = items?.find((item) => item.kind === "thread" && item.key === args.active.id);
    const container = (marker: SidebarListMarker) =>
      args.droppableContainers.find((candidate) => candidate.id === sidebarMarkerId(marker));
    const divider = container("pinned-divider")
      ?.node.current?.querySelector(".sidebar-drag-boundary-label")
      ?.getBoundingClientRect();
    if (items && divider && source?.kind === "thread" && pointer) {
      side ??= source.section === "pinned" ? "pinned" : "active";
      const lastY = previousY ?? pointer.y;
      previousY = pointer.y;
      if (pointer.x >= divider.left && pointer.x <= divider.right) {
        if (pointer.y < lastY && pointer.y <= divider.bottom) side = "pinned";
        else if (pointer.y > lastY && pointer.y >= divider.top) side = "active";
        const activeBottom = SHELF_HEADERS.map(container)
          .find((candidate) => candidate !== undefined)
          ?.node.current?.getBoundingClientRect().top;
        if (side === "pinned" || (activeBottom !== undefined && pointer.y < activeBottom)) {
          const wanted = side;
          const preferred = collisions.find((collision) => {
            const id = String(collision.id);
            if (!sectionOf.has(id)) {
              sectionOf.set(
                id,
                resolveSidebarDropTarget(items, String(args.active.id), id)?.section ?? null,
              );
            }
            return sectionOf.get(id) === wanted;
          });
          if (preferred) {
            collisions = [preferred, ...collisions.filter((collision) => collision !== preferred)];
          }
        }
      }
    }
    const nearest = collisions[0];
    if (!nearest || nearest.id === args.active.id) return collisions;
    const id = String(nearest.id);
    let valid = validity.get(id);
    if (valid === undefined) {
      valid = isValidTarget(id);
      validity.set(id, valid);
    }
    return valid ? collisions : collisions.filter((collision) => collision.id === args.active.id);
  };
}

/**
 * Where every row goes while a thread is dragged: the list is laid out
 * again as it would be after the drop, with the dragged thread in its
 * destination section, and each row slides to its new place. A thread
 * dropped into Settled goes to its settled rank (`settledOrder`, newest
 * first, with the dragged thread counted as just settled); with the
 * Working shelf on, one dropped into Active goes to its time slot
 * (`activeOrder`). Rows of a folded shelf stay hidden, except the one in
 * view. Off (`enabled: false`), nothing moves.
 */
export function createSidebarSortingStrategy(input: {
  readonly items: ReadonlyArray<SidebarListItem>;
  readonly enabled?: boolean;
  readonly settledOrder: ReadonlyArray<string>;
  readonly activeOrder?: ReadonlyArray<string>;
  readonly settledExpanded: boolean;
  readonly settledVisibleCount?: number;
  readonly routeThreadKey?: string | null;
  readonly snoozedThreadCount?: number;
  readonly cardHeight?: number;
  readonly slimHeight?: number;
  readonly boundaryLabelHeight?: number;
}): SortingStrategy {
  if (input.enabled === false) return () => STATIONARY;
  const { items } = input;
  const indexById = new Map(items.map((item, index) => [sidebarListItemId(item), index]));
  let last: Pick<Layout, "rects" | "activeIndex" | "overIndex"> | undefined;
  let transforms: ReadonlyArray<Transform> = [];

  const project = ({ rects, activeIndex, overIndex }: Layout): ReadonlyArray<Transform> => {
    const active = items[activeIndex];
    const over = items[overIndex] ?? active;
    if (active?.kind !== "thread" || !over || !rects[0]) return [];
    const target = resolveSidebarDropTarget(items, active.key, sidebarListItemId(over));
    if (!target) return [];

    // Measure the rows; the root font size scales the defaults.
    let cardHeight = input.cardHeight;
    let slimHeight = input.slimHeight;
    let headerScale: number | undefined;
    const groups: Record<SidebarListSection, ThreadItem[]> = {
      pinned: [],
      active: [],
      working: [],
      snoozed: [],
      settled: [],
    };
    items.forEach((item, index) => {
      const height = rects[index]?.height;
      if (item.kind === "marker") {
        if (isShelfHeader(item) && height) headerScale ??= height / HEADER_HEIGHT;
        return;
      }
      if (isCardSection(item.section)) cardHeight ??= height;
      else slimHeight ??= height;
      if (item.key !== active.key) groups[item.section].push(item);
    });
    const scale =
      slimHeight !== undefined
        ? slimHeight / SLIM_HEIGHT
        : (headerScale ?? (cardHeight ?? CARD_HEIGHT) / CARD_HEIGHT);
    const card = cardHeight ?? CARD_HEIGHT * scale;
    const slim = slimHeight ?? SLIM_HEIGHT * scale;
    const labelHeight = (input.boundaryLabelHeight ?? 0) * scale;

    // Put the dragged thread into its destination at its rank there.
    const order =
      target.section === "pinned"
        ? target.pinnedOrder
        : target.section === "settled"
          ? input.settledOrder
          : (input.activeOrder ?? target.activeOrder);
    const rankOf = new Map(order.map((key, index) => [key, index]));
    const rank = rankOf.get(active.key) ?? Number.POSITIVE_INFINITY;
    const destination = groups[target.section];
    const at = destination.findIndex(
      (item) => (rankOf.get(item.key) ?? Number.POSITIVE_INFINITY) > rank,
    );
    destination.splice(at < 0 ? destination.length : at, 0, {
      ...active,
      section: target.section,
    });

    // Settled shows its page, or only the thread in view while folded.
    const settledKeys = (
      input.settledOrder.length > 0 ? input.settledOrder : groups.settled.map((item) => item.key)
    ).filter((key) => key !== active.key || target.section === "settled");
    const shownSettled = input.settledExpanded
      ? settledKeys.slice(0, input.settledVisibleCount ?? settledKeys.length)
      : [];
    const routeKey = input.routeThreadKey;
    if (routeKey && settledKeys.includes(routeKey) && !shownSettled.includes(routeKey)) {
      shownSettled.push(routeKey);
    }
    groups.settled = shownSettled.map((key) => ({ kind: "thread", key, section: "settled" }));

    const projected: SidebarListItem[] = [];
    const marker = (name: SidebarListMarker) => projected.push({ kind: "marker", marker: name });
    const sectionRows = (name: "active" | "settled") => {
      if (groups[name].length > 0) projected.push(...groups[name]);
      else marker(`${name}-placeholder`);
    };
    const hasMarker = (name: SidebarListMarker) =>
      items.some((item) => item.kind === "marker" && item.marker === name);
    marker("pinned-header");
    projected.push(...groups.pinned);
    marker("pinned-divider");
    sectionRows("active");
    if (hasMarker("working-header")) {
      marker("working-header");
      projected.push(...groups.working);
    }
    // Snoozed loses its header when its last thread leaves.
    if (
      groups.snoozed.length > 0 ||
      ((active.section !== "snoozed" || (input.snoozedThreadCount ?? 0) > 1) &&
        hasMarker("snoozed-header"))
    ) {
      marker("snoozed-header");
      projected.push(...groups.snoozed);
    }
    marker("settled-header");
    sectionRows("settled");

    const heightOf = (item: SidebarListItem): number => {
      if (item.kind === "marker") {
        if (item.marker === "pinned-header" || item.marker === "pinned-divider") return labelHeight;
        if (item.marker.endsWith("placeholder")) return slim;
      }
      const fallback = item.kind === "thread" && isCardSection(item.section) ? card : slim;
      // The dragged row takes its destination's height.
      if (item.kind === "thread" && item.key === active.key) return fallback;
      const index = indexById.get(sidebarListItemId(item));
      return (index === undefined ? undefined : rects[index]?.height) ?? fallback;
    };
    const heights = projected.map(heightOf);

    // The shelves sit at the bottom of the list; keep the free space above them.
    const firstShelf = items.findIndex(isShelfHeader);
    const shelfRect = rects[firstShelf];
    const aboveShelf = rects[firstShelf - 1];
    const lastRect = rects.at(-1);
    let freeSpace =
      shelfRect && aboveShelf && lastRect && shelfRect.top > aboveShelf.bottom + 1
        ? Math.max(
            0,
            lastRect.bottom - rects[0].top - heights.reduce((sum, height) => sum + height + 1, -1),
          )
        : 0;

    const result: Transform[] = items.map(() => COLLAPSED);
    let top = rects[0].top;
    projected.forEach((item, position) => {
      if (isShelfHeader(item)) {
        top += freeSpace;
        freeSpace = 0;
      }
      const index = indexById.get(sidebarListItemId(item));
      const rect = index === undefined ? undefined : rects[index];
      if (index !== undefined && rect) result[index] = { ...STATIONARY, y: top - rect.top };
      top += heights[position]! + 1;
    });
    result[activeIndex] = STATIONARY;
    return result;
  };

  return (args) => {
    if (
      last?.rects !== args.rects ||
      last.activeIndex !== args.activeIndex ||
      last.overIndex !== args.overIndex
    ) {
      last = args;
      transforms = project(args);
    }
    return transforms[args.index] ?? STATIONARY;
  };
}

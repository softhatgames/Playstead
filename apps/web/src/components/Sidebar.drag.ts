import type { SidebarSection } from "./Sidebar.inbox.logic.ts";

type DropAction = "pin" | "unpin" | "settle" | "unsettle" | "wake";
export interface ThreadDropPlan {
  readonly badge: string | null;
  readonly actions: ReadonlyArray<DropAction>;
  readonly reorder: "pinned" | "active" | null;
}

/** Shelf transitions from T3 Code Sidebar.logic.ts at 2577baf. Working and
 * Snoozed are source-only shelves; Working makes Active time ordered. */
export function planThreadDrop(input: {
  from: SidebarSection;
  to: SidebarSection;
  workingShelfEnabled: boolean;
  pinned: boolean;
  settled: boolean;
  canSettle: boolean;
}): ThreadDropPlan | null {
  const { from, to } = input;
  if (to === "working" || to === "snoozed") return null;
  if (to === "settled") {
    if (from === "settled" || !input.canSettle) return null;
    return {
      badge: "Settle",
      actions: from === "snoozed" ? ["wake", "settle"] : ["settle"],
      reorder: null,
    };
  }
  if (to === "pinned")
    return {
      badge: from === to ? null : "Pin",
      actions: from === to ? [] : ["pin"],
      reorder: "pinned",
    };
  if (from === "active" && input.workingShelfEnabled) return null;
  const actions: DropAction[] = [];
  if (from === "snoozed") actions.push("wake");
  if (input.pinned) actions.push("unpin");
  if (input.settled) actions.push("unsettle");
  return {
    badge:
      from === "pinned"
        ? "Unpin"
        : from === "settled"
          ? "Un-settle"
          : from === "snoozed"
            ? "Wake"
            : null,
    actions,
    reorder: input.workingShelfEnabled ? null : "active",
  };
}

export function settleSweep(
  order: ReadonlyArray<string>,
  origin: string,
  target: string,
  canSettle: (id: string) => boolean,
): string[] {
  const a = order.indexOf(origin);
  const b = order.indexOf(target);
  return a < 0 || b < 0 ? [] : order.slice(Math.min(a, b), Math.max(a, b) + 1).filter(canSettle);
}

/** The row under the pointer supplies its slot; a shelf header means top. */
export function threadDropOrder(
  current: ReadonlyArray<string>,
  moved: string,
  over: string | null,
): ReadonlyArray<string> | null {
  const destination = over === null ? 0 : Math.max(0, current.indexOf(over));
  const next = current.filter((id) => id !== moved);
  next.splice(destination, 0, moved);
  return next.length === current.length && next.every((id, i) => id === current[i]) ? null : next;
}

export type SidebarSweepAction = "settle" | "unsettle" | "wake";

/** Row actions stay within their shelf, as Sidebar.tsx at T3 Code 2577baf. */
export function actionSweep(
  rows: ReadonlyArray<{ readonly id: string; readonly status: string }>,
  origin: string,
  target: string,
  action: SidebarSweepAction,
  section: SidebarSection,
): string[] {
  if (
    action === "wake"
      ? section !== "snoozed"
      : action === "unsettle"
        ? section !== "settled"
        : section === "settled" || section === "snoozed"
  )
    return [];
  return settleSweep(
    rows.map((row) => row.id),
    origin,
    target,
    (id) =>
      action !== "settle" ||
      !["starting", "running", "waiting"].includes(rows.find((row) => row.id === id)!.status),
  );
}

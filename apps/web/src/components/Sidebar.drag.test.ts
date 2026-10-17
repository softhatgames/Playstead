import { expect, it } from "@effect/vitest";
import { planThreadDrop, settleSweep } from "./Sidebar.drag.ts";

it("plans shelf transitions, with no placement within time-ordered Active", () => {
  const move = (
    from: "active" | "pinned" | "settled" | "snoozed" | "working",
    to: typeof from,
    working = false,
    pinned = from === "pinned",
    settled = from === "settled",
  ) => planThreadDrop({ from, to, workingShelfEnabled: working, pinned, settled, canSettle: true });
  expect(move("active", "pinned")).toEqual({ badge: "Pin", actions: ["pin"], reorder: "pinned" });
  expect(move("pinned", "active")).toEqual({
    badge: "Unpin",
    actions: ["unpin"],
    reorder: "active",
  });
  expect(move("settled", "active")).toEqual({
    badge: "Un-settle",
    actions: ["unsettle"],
    reorder: "active",
  });
  expect(move("snoozed", "active", false, true, true)).toEqual({
    badge: "Wake",
    actions: ["wake", "unpin", "unsettle"],
    reorder: "active",
  });
  expect(move("snoozed", "settled")).toEqual({
    badge: "Settle",
    actions: ["wake", "settle"],
    reorder: null,
  });
  expect(move("active", "active", true)).toBeNull();
  expect(move("pinned", "active", true)?.reorder).toBeNull();
  expect(move("working", "pinned", true)?.badge).toBe("Pin");
  expect(move("active", "working")).toBeNull();
  expect(move("active", "snoozed")).toBeNull();
  expect(move("settled", "settled")).toBeNull();
  expect(
    planThreadDrop({
      from: "working",
      to: "settled",
      workingShelfEnabled: true,
      pinned: false,
      settled: false,
      canSettle: false,
    }),
  ).toBeNull();
});

it("settle sweeping includes skipped-over rows in either direction, excluding busy rows", () => {
  expect(settleSweep(["a", "b", "c", "d"], "d", "a", (id) => id !== "b")).toEqual(["a", "c", "d"]);
  expect(settleSweep(["a"], "missing", "a", () => true)).toEqual([]);
});

it("places rows at the hovered slot and leaves an unchanged order alone", async () => {
  const { threadDropOrder } = await import("./Sidebar.drag.ts");
  expect(threadDropOrder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  expect(threadDropOrder(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
  expect(threadDropOrder(["a", "b"], "c", null)).toEqual(["c", "a", "b"]);
  expect(threadDropOrder(["a", "b"], "a", null)).toBeNull();
  expect(threadDropOrder(["a", "b"], "a", "a")).toBeNull();
});

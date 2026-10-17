import { assert, describe, it } from "@effect/vitest";

import {
  buildSidebarListItems,
  planSidebarThreadDrop,
  resolveSidebarDropTarget,
  resolveSidebarDropVerb,
  resolveSidebarSweepKeys,
  canApplySidebarSweep,
  type SidebarListSection,
  sidebarMarkerId,
} from "./Sidebar.drag.logic.ts";

/**
 * Where a dragged thread lands and what the drop does (T3 Code's
 * `Sidebar.logic.ts` drag functions and `Sidebar.logic.test.ts` "dragging"
 * at 2577baf).
 */

const items = buildSidebarListItems({
  pinned: ["p1", "p2"],
  active: ["a1", "a2"],
  working: [],
  snoozed: [],
  settled: ["s1"],
  hasWorking: false,
  hasSnoozed: false,
});

const keys = (entries: ReadonlyArray<readonly [string, string | null]>) => new Map(entries);
const pinnedKeysById = keys([
  ["p1", "f"],
  ["p2", "t"],
  ["a1", null],
  ["a2", null],
  ["s1", null],
]);
const activeKeysById = keys([
  ["p1", null],
  ["p2", null],
  ["a1", null],
  ["a2", null],
  ["s1", null],
]);

const plan = (
  activeKey: string,
  activeSection: SidebarListSection,
  overId: string,
  options: { readonly activeTimeOrdered?: boolean; readonly list?: typeof items } = {},
) => {
  const list = options.list ?? items;
  const target = resolveSidebarDropTarget(list, activeKey, overId);
  if (target === null) return null;
  return planSidebarThreadDrop({
    activeKey,
    activeSection,
    target,
    pinnedOrder: ["p1", "p2"],
    pinnedKeysById,
    activeOrder: ["a1", "a2"],
    activeKeysById,
    activeTimeOrdered: options.activeTimeOrdered ?? false,
  });
};

describe("the sidebar's drag list", () => {
  it("lays out each section between its markers", () => {
    assert.deepStrictEqual(
      items.map((item) => (item.kind === "thread" ? `${item.key}:${item.section}` : item.marker)),
      [
        "pinned-header",
        "p1:pinned",
        "p2:pinned",
        "pinned-divider",
        "active-placeholder",
        "a1:active",
        "a2:active",
        "settled-header",
        "settled-placeholder",
        "s1:settled",
      ],
    );
  });
});

describe("dropping a dragged thread", () => {
  it("reorders Pinned with one new key", () => {
    assert.deepStrictEqual(plan("p2", "pinned", "p1"), {
      kind: "reorder-pinned",
      order: ["p2", "p1"],
      assignments: [{ id: "p2", orderKey: "d" }],
    });
  });

  it("pins an active thread where it is dropped among the pins", () => {
    assert.deepStrictEqual(plan("a2", "active", "p1"), {
      kind: "pin",
      order: ["a2", "p1", "p2"],
      orderKey: "d",
      extraAssignments: [],
    });
  });

  it("unpins a pinned thread dropped into Active, keeping the place it was dropped", () => {
    assert.deepStrictEqual(plan("p1", "pinned", "a1"), {
      kind: "move-active",
      order: ["a1", "p1", "a2"],
      assignments: [
        { id: "a1", orderKey: "gn" },
        { id: "p1", orderKey: "nb" },
        { id: "a2", orderKey: "tn" },
      ],
      unpin: true,
      unsettle: false,
      unsnooze: false,
    });
  });

  it("settles a thread dropped onto the Settled header", () => {
    assert.deepStrictEqual(plan("a1", "active", sidebarMarkerId("settled-header")), {
      kind: "settle",
    });
    assert.deepStrictEqual(plan("p1", "pinned", "s1"), { kind: "settle" });
  });

  it("un-settles a settled thread dropped into Active", () => {
    assert.deepStrictEqual(plan("s1", "settled", "a2"), {
      kind: "move-active",
      order: ["a1", "s1", "a2"],
      assignments: [
        { id: "a1", orderKey: "gn" },
        { id: "s1", orderKey: "nb" },
        { id: "a2", orderKey: "tn" },
      ],
      unpin: false,
      unsettle: true,
      unsnooze: false,
    });
  });

  it("does nothing when the thread goes back where it was", () => {
    assert.deepStrictEqual(plan("a1", "active", "a1"), { kind: "none" });
    assert.deepStrictEqual(plan("s1", "settled", "s1"), { kind: "none" });
    assert.deepStrictEqual(plan("p1", "pinned", "p1"), { kind: "none" });
  });

  it("wakes a snoozed thread dragged out of its shelf, and never drops into Snoozed or Working", () => {
    const list = buildSidebarListItems({
      pinned: [],
      active: ["a1", "a2"],
      working: ["w1"],
      snoozed: ["z1"],
      settled: [],
      hasWorking: true,
      hasSnoozed: true,
    });
    assert.deepStrictEqual(plan("z1", "snoozed", "a1", { list }), {
      kind: "move-active",
      order: ["z1", "a1", "a2"],
      assignments: [
        { id: "z1", orderKey: "gn" },
        { id: "a1", orderKey: "nb" },
        { id: "a2", orderKey: "tn" },
      ],
      unpin: false,
      unsettle: false,
      unsnooze: true,
    });
    assert.isNull(plan("a1", "active", "z1", { list }));
    assert.isNull(plan("a1", "active", "w1", { list }));
    assert.isNull(plan("a1", "active", sidebarMarkerId("snoozed-header"), { list }));
  });

  it("only moves a thread between sections while the Working shelf orders Active by time", () => {
    assert.deepStrictEqual(plan("a2", "active", "a1", { activeTimeOrdered: true }), {
      kind: "none",
    });
    assert.deepStrictEqual(plan("s1", "settled", "a1", { activeTimeOrdered: true }), {
      kind: "move-active",
      order: null,
      assignments: [],
      unpin: false,
      unsettle: true,
      unsnooze: false,
    });
  });
});

describe("the drop badge", () => {
  it("names what the drop does when the thread changes section", () => {
    const verbs = (
      [
        ["active", "pinned"],
        ["pinned", "active"],
        ["active", "settled"],
        ["settled", "active"],
        ["settled", "pinned"],
        ["snoozed", "active"],
        ["active", "active"],
        ["active", "snoozed"],
        ["active", "working"],
        ["active", null],
      ] as const
    ).map(([from, to]) => resolveSidebarDropVerb(from, to));
    assert.deepStrictEqual(verbs, [
      "pin",
      "unpin",
      "settle",
      "unsettle",
      "pin",
      "wake",
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("press-and-drag Settle", () => {
  it("covers every row between the pressed row and the pointer, in either direction", () => {
    const ordered = ["a", "b", "c", "d", "e"];
    const all = () => true;
    assert.deepStrictEqual(resolveSidebarSweepKeys(ordered, "b", "d", all), ["b", "c", "d"]);
    assert.deepStrictEqual(resolveSidebarSweepKeys(ordered, "d", "b", all), ["b", "c", "d"]);
  });

  it("leaves out rows that cannot settle and rows that left the list", () => {
    const ordered = ["a", "b", "c", "d"];
    assert.deepStrictEqual(
      resolveSidebarSweepKeys(ordered, "a", "d", (key) => key !== "c"),
      ["a", "b", "d"],
    );
    assert.deepStrictEqual(
      resolveSidebarSweepKeys(ordered, "a", "gone", () => true),
      [],
    );
  });
});

it("sweeps in either direction, skips busy rows, and refuses a busy origin or another shelf", () => {
  const idle = {
    status: "idle" as const,
    hasPendingUserInput: false,
    hasQueuedRun: false,
    settledOverride: null,
    snoozedUntil: null,
  };
  const allowed = (key: string) =>
    canApplySidebarSweep({
      thread: { ...idle, hasQueuedRun: key === "b" },
      action: "settle",
      section: key === "d" ? "pinned" : "active",
      originSection: "active",
    });
  assert.deepStrictEqual(resolveSidebarSweepKeys(["a", "b", "c", "d"], "a", "d", allowed), [
    "a",
    "c",
  ]);
  assert.deepStrictEqual(resolveSidebarSweepKeys(["a", "b", "c", "d"], "c", "a", allowed), [
    "a",
    "c",
  ]);
  assert.deepStrictEqual(resolveSidebarSweepKeys(["a", "b", "c"], "b", "c", allowed), []);
  assert.isFalse(
    canApplySidebarSweep({
      thread: { ...idle, hasPendingUserInput: true },
      action: "settle",
      section: "active",
      originSection: "active",
    }),
  );
  assert.isTrue(
    canApplySidebarSweep({
      thread: { ...idle, settledOverride: "settled" },
      action: "unsettle",
      section: "settled",
      originSection: "settled",
    }),
  );
  assert.isTrue(
    canApplySidebarSweep({
      thread: { ...idle, snoozedUntil: "2026-11-01" },
      action: "unsnooze",
      section: "snoozed",
      originSection: "snoozed",
    }),
  );
});

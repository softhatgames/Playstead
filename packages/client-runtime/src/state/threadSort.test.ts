import { describe, expect, it } from "@effect/vitest";
import { orderKeyBetween, planThreadReorder } from "./threadSort.ts";

describe("fractional thread order", () => {
  it("makes a–z midpoints including adjacent and prefix neighbors", () => {
    expect(orderKeyBetween(null, null)).toBe("n");
    expect(orderKeyBetween("b", "d")).toBe("c");
    expect(orderKeyBetween("b", "c")).toBe("bn");
    expect(orderKeyBetween(null, "b")).toBe("an");
    expect(orderKeyBetween("b", "bb")).toBe("ban");
    expect(orderKeyBetween("z", null)).toBe("zn");
    for (const [left, right] of [
      ["a", "b"],
      ["B", "c"],
      ["d", "b"],
      ["b", "b"],
      ["", "b"],
    ]) {
      expect(orderKeyBetween(left!, right!)).toBeNull();
    }
  });
});

it("arranges keyless rows and repairs corrupt neighbors without writing hidden rows or colliding with their keys", () => {
  const keys = new Map([
    ["hidden", "n"],
    ["a", null],
    ["b", null],
    ["c", null],
  ]);
  const assignments = planThreadReorder(["c", "a", "b"], keys, "c");
  expect(assignments.map((x) => x.id)).toEqual(["c", "a", "b"]);
  const positions = assignments.map((x) => x.orderKey);
  expect(positions).toEqual([...positions].sort());
  expect(new Set(positions).size).toBe(3);
  expect(positions).not.toContain("n");
  const arranged = new Map([
    ["a", "b"],
    ["b", "d"],
    ["c", "f"],
    ["hidden", "c"],
  ]);
  const moved = planThreadReorder(["a", "c", "b"], arranged, "c");
  expect(moved).toHaveLength(1);
  expect(moved[0]!.orderKey > "b" && moved[0]!.orderKey < "d").toBe(true);
  expect(moved[0]!.orderKey).not.toBe("c");
  expect(planThreadReorder(["a"], arranged, "missing")).toEqual([]);
});

it("keeps room through repeated prepend and adjacent insertions, and repairs reversed keys", () => {
  let upper = "b";
  for (let i = 0; i < 100; i++) {
    const next = orderKeyBetween(null, upper)!;
    expect(next).toMatch(/^[a-z]+$/);
    expect(next < upper).toBe(true);
    expect(next.endsWith("a")).toBe(false);
    upper = next;
  }
  const replacements = planThreadReorder(
    ["a", "moved", "b"],
    new Map([
      ["a", "z"],
      ["b", "b"],
    ]),
    "moved",
  );
  expect(replacements.map((item) => item.id)).toEqual(["a", "moved", "b"]);
  expect(replacements.map((item) => item.orderKey)).toEqual(["gn", "nb", "tn"]);
});

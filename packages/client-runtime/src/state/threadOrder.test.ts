import { assert, describe, it } from "@effect/vitest";

import { pinOrderKeyBetween, planThreadReorder, spreadOrderKeys } from "./threadOrder.ts";

describe("pinOrderKeyBetween", () => {
  it("makes a key above, below and between others, and none for corrupt bounds", () => {
    assert.strictEqual(pinOrderKeyBetween(null, null), "n");
    assert.strictEqual(pinOrderKeyBetween(null, "n"), "h");
    assert.strictEqual(pinOrderKeyBetween("n", null), "u");
    assert.strictEqual(pinOrderKeyBetween("g", "n"), "k");
    // Neighbouring digits leave no room at one place, so the key grows.
    assert.strictEqual(pinOrderKeyBetween("g", "h"), "gn");
    assert.strictEqual(pinOrderKeyBetween(null, "b"), "an");
    assert.isNull(pinOrderKeyBetween("n", "g"));
    assert.isNull(pinOrderKeyBetween("n", "n"));
    assert.isNull(pinOrderKeyBetween("A", null));
    // A trailing "a" leaves nothing to put before it, so no generator makes one.
    assert.isNull(pinOrderKeyBetween(null, "ba"));
  });
});

describe("planThreadReorder", () => {
  it("moves a thread between two arranged neighbours with one write", () => {
    assert.deepStrictEqual(
      planThreadReorder({
        orderedIds: ["a", "moved", "b"],
        keysById: new Map([
          ["a", "f"],
          ["b", "t"],
          ["moved", "z"],
        ]),
        movedId: "moved",
      }),
      [{ id: "moved", orderKey: "m" }],
    );
  });

  it("steps past a key held by a thread that is not shown", () => {
    assert.deepStrictEqual(
      planThreadReorder({
        orderedIds: ["a", "moved", "b"],
        keysById: new Map([
          ["a", "f"],
          ["b", "t"],
          ["moved", "z"],
          ["hidden", "m"],
        ]),
        movedId: "moved",
      }),
      [{ id: "moved", orderKey: "q" }],
    );
  });

  it("arranges the whole section when a neighbour has no key, leaving hidden keys alone", () => {
    assert.deepStrictEqual(
      planThreadReorder({
        orderedIds: ["c", "a", "b"],
        keysById: new Map<string, string | null>([
          ["a", null],
          ["b", "pq"],
          ["c", null],
          ["hidden", "kk"],
        ]),
        movedId: "c",
      }),
      [
        { id: "c", orderKey: "ff" },
        { id: "a", orderKey: "pq" },
        { id: "b", orderKey: "uv" },
      ],
    );
  });

  it("writes nothing for a thread that is not in the order", () => {
    assert.deepStrictEqual(
      planThreadReorder({ orderedIds: ["a"], keysById: new Map(), movedId: "b" }),
      [],
    );
  });
});

describe("spreadOrderKeys", () => {
  it("leaves room before every key, however many threads there are", () => {
    assert.deepStrictEqual(spreadOrderKeys(3), ["gn", "nb", "tn"]);
    for (const count of [0, 1, 650, 675, 676, 1_001, 2_000]) {
      const keys = spreadOrderKeys(count);
      assert.strictEqual(keys.length, count);
      assert.strictEqual(new Set(keys).size, count);
      assert.deepStrictEqual(keys.toSorted(), keys);
      keys.forEach((key, index) => {
        const between = pinOrderKeyBetween(keys[index - 1] ?? null, key);
        assert.isNotNull(between, `room before ${key}`);
      });
    }
  });
});

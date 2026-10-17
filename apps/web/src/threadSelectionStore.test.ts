import { assert, beforeEach, describe, it } from "@effect/vitest";

import {
  clearThreadSelection,
  rangeSelectThreadsTo,
  readThreadSelection,
  removeFromThreadSelection,
  setThreadSelectionAnchor,
  toggleThreadSelection,
} from "./threadSelectionStore.ts";

/**
 * Selecting several threads in the sidebar (T3 Code's
 * `apps/web/src/threadSelectionStore.ts` at 2577baf): mod-click toggles a
 * thread, shift-click selects from the anchor to the thread.
 */

const selected = () => [...readThreadSelection().selectedThreadIds].toSorted();
const order = ["a", "b", "c", "d", "e"];

describe("thread selection", () => {
  beforeEach(() => clearThreadSelection());

  it("mod-click adds a thread and makes it the anchor, and a second one removes it", () => {
    toggleThreadSelection("b");
    assert.deepStrictEqual(selected(), ["b"]);
    assert.strictEqual(readThreadSelection().anchorThreadId, "b");
    toggleThreadSelection("b");
    assert.deepStrictEqual(selected(), []);
  });

  it("shift-click selects every thread from the anchor to the one clicked, in the list's order", () => {
    setThreadSelectionAnchor("d");
    rangeSelectThreadsTo("b", order);
    assert.deepStrictEqual(selected(), ["b", "c", "d"]);
    assert.strictEqual(readThreadSelection().anchorThreadId, "d");
  });

  it("shift-click without an anchor selects just the thread and anchors there", () => {
    rangeSelectThreadsTo("c", order);
    assert.deepStrictEqual(selected(), ["c"]);
    assert.strictEqual(readThreadSelection().anchorThreadId, "c");
  });

  it("removing the anchor from the selection drops the anchor too", () => {
    toggleThreadSelection("a");
    toggleThreadSelection("c");
    removeFromThreadSelection(["c"]);
    assert.deepStrictEqual(selected(), ["a"]);
    assert.isNull(readThreadSelection().anchorThreadId);
  });
});

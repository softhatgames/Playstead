import { afterEach, assert, beforeEach, describe, it, vi } from "@effect/vitest";

import { readToasts } from "../components/ui/toast.tsx";
import {
  readThreadUndoNotice,
  showThreadUndoNotice,
  undoLatestThreadAction,
} from "./showThreadUndoNotice.ts";
import * as ThreadUndo from "./threadUndo.ts";

/**
 * Undo after unpinning, settling or archiving (T3 Code's
 * `apps/web/src/hooks/showThreadUndoNotice.test.ts` and `threadUndo.test.ts`
 * at 2577baf, as behaviour): one notice for the latest action, counting the
 * threads it was done to, for five seconds.
 */

const settle = (threadKey: string, undone: Array<string>, failure?: Error) => {
  const claim = ThreadUndo.begin("settle", threadKey);
  showThreadUndoNotice({
    action: "Settled",
    claim,
    failureTitle: "Failed to undo settle",
    undo: async () => {
      if (failure !== undefined) throw failure;
      undone.push(threadKey);
    },
  });
  return claim;
};

describe("thread undo notices", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(async () => {
    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });

  it("undoes the latest action once, then has nothing left to undo", async () => {
    const undone: Array<string> = [];
    settle("a", undone);
    assert.deepStrictEqual(
      { action: readThreadUndoNotice()?.action, count: readThreadUndoNotice()?.count },
      { action: "Settled", count: 1 },
    );
    assert.isTrue(undoLatestThreadAction());
    await vi.runAllTimersAsync();
    assert.deepStrictEqual(undone, ["a"]);
    assert.isNull(readThreadUndoNotice());
    assert.isFalse(undoLatestThreadAction());
  });

  it("counts the same action on several threads in one notice, and undoes them together", async () => {
    const undone: Array<string> = [];
    settle("a", undone);
    settle("b", undone);
    assert.strictEqual(readThreadUndoNotice()?.count, 2);
    undoLatestThreadAction();
    await vi.runAllTimersAsync();
    assert.deepStrictEqual(undone.toSorted(), ["a", "b"]);
  });

  it("shows only the latest kind of action", async () => {
    const undone: Array<string> = [];
    settle("a", undone);
    const claim = ThreadUndo.begin("pin", "b");
    showThreadUndoNotice({
      action: "Unpinned",
      claim,
      failureTitle: "Failed to undo unpin",
      undo: async () => {
        undone.push("pin b");
      },
    });
    assert.deepStrictEqual(
      { action: readThreadUndoNotice()?.action, count: readThreadUndoNotice()?.count },
      { action: "Unpinned", count: 1 },
    );
    undoLatestThreadAction();
    await vi.runAllTimersAsync();
    assert.deepStrictEqual(undone, ["pin b"]);
  });

  it("goes after five seconds", async () => {
    settle("a", []);
    await vi.advanceTimersByTimeAsync(4_999);
    assert.isNotNull(readThreadUndoNotice());
    await vi.advanceTimersByTimeAsync(1);
    assert.isNull(readThreadUndoNotice());
    assert.isFalse(undoLatestThreadAction());
  });

  it("drops an action that something later superseded, such as un-settling the thread", () => {
    settle("a", []);
    ThreadUndo.invalidate("settle", "a");
    assert.isNull(readThreadUndoNotice());
  });

  it("reports an undo that fails", async () => {
    settle("a", [], new Error("Thread a is deleted."));
    undoLatestThreadAction();
    // Lets the undo settle without running the notice's own five seconds.
    await vi.advanceTimersByTimeAsync(0);
    assert.deepStrictEqual(
      readToasts()
        .filter((toast) => toast.type === "error")
        .map((toast) => [toast.title, toast.description]),
      [["Failed to undo settle", "Thread a is deleted."]],
    );
  });
});

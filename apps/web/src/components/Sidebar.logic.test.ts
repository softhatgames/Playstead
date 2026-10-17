import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { assert, describe, it } from "@effect/vitest";

import {
  hasUnseenCompletion,
  isTrailingDoubleClick,
  resolveProjectStatusIndicator,
} from "./Sidebar.logic.ts";

describe("hasUnseenCompletion", () => {
  const completedAt = "2026-10-17T12:00:00.000Z";

  it("shows the dot when the latest run completed after the thread was last visited", () => {
    assert.isTrue(
      hasUnseenCompletion({
        latestRunCompletedAt: completedAt,
        lastVisitedAt: "2026-10-17T11:59:59.999Z",
      }),
    );
  });

  it("hides it once the thread was visited at or after the completion", () => {
    for (const lastVisitedAt of [completedAt, "2026-10-17T12:00:05.000Z"]) {
      assert.isFalse(hasUnseenCompletion({ latestRunCompletedAt: completedAt, lastVisitedAt }));
    }
  });

  it("hides it while the latest run has not completed, or the thread was never visited", () => {
    assert.isFalse(
      hasUnseenCompletion({
        latestRunCompletedAt: null,
        lastVisitedAt: "2026-10-17T11:00:00.000Z",
      }),
    );
    assert.isFalse(hasUnseenCompletion({ latestRunCompletedAt: completedAt, lastVisitedAt: null }));
  });
});

describe("isTrailingDoubleClick", () => {
  it("is the second click of a double-click, which must not navigate", () => {
    assert.deepStrictEqual(
      [0, 1, 2, 3].map((detail) => isTrailingDoubleClick(detail)),
      [false, false, true, true],
    );
  });
});

describe("resolveProjectStatusIndicator", () => {
  const completedAt = "2026-10-17T12:00:00.000Z";
  const thread = (
    status: OrchestrationV2ThreadShell["status"],
    lastVisitedAt: string | null = completedAt,
  ) => ({ status, latestRunCompletedAt: completedAt, lastVisitedAt });
  const seenLongAgo = "2026-10-17T11:00:00.000Z";

  it("shows nothing for a folded project whose threads have no status", () => {
    assert.isNull(resolveProjectStatusIndicator([]));
    assert.isNull(resolveProjectStatusIndicator([thread("completed"), thread("idle")]));
  });

  it("shows the most pressing status of its threads: working before completed", () => {
    assert.strictEqual(
      resolveProjectStatusIndicator([thread("completed", seenLongAgo)]),
      "Completed",
    );
    assert.strictEqual(
      resolveProjectStatusIndicator([thread("completed", seenLongAgo), thread("running")]),
      "Working",
    );
  });
});

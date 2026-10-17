import { assert, describe, it } from "@effect/vitest";
import { ThreadId } from "@playstead/contracts/baseSchemas";

import { resolveThreadVisit, VISIT_DISPATCH_THROTTLE_MS } from "./threadVisit.logic.ts";

const threadId = ThreadId.make("thread:1");
const updatedAt = "2026-10-17T12:00:00.000Z";
const now = Date.parse("2026-10-17T12:00:01.000Z");
const nothingSent = { lastDispatchedKey: null, lastDispatchAt: 0, now } as const;

describe("resolveThreadVisit", () => {
  it("visits a thread viewed for the first time, at its last activity", () => {
    assert.deepStrictEqual(
      resolveThreadVisit({
        thread: { id: threadId, updatedAt, lastVisitedAt: null, latestRunCompletedAt: null },
        ...nothingSent,
      }),
      { kind: "now", key: `${threadId}:${updatedAt}`, visitedAt: updatedAt },
    );
  });

  it("does not visit a thread already visited since its last activity", () => {
    assert.deepStrictEqual(
      resolveThreadVisit({
        thread: {
          id: threadId,
          updatedAt,
          lastVisitedAt: updatedAt,
          latestRunCompletedAt: updatedAt,
        },
        ...nothingSent,
      }),
      { kind: "none" },
    );
  });

  it("does not visit again for activity it already sent a visit for, so Mark unread on the open thread sticks", () => {
    assert.deepStrictEqual(
      resolveThreadVisit({
        thread: {
          id: threadId,
          updatedAt,
          lastVisitedAt: "2026-10-17T11:59:59.999Z",
          latestRunCompletedAt: updatedAt,
        },
        lastDispatchedKey: `${threadId}:${updatedAt}`,
        lastDispatchAt: now - 1_000,
        now,
      }),
      { kind: "none" },
    );
  });

  it("visits at once when a run completed unseen, however recently it last visited", () => {
    assert.deepStrictEqual(
      resolveThreadVisit({
        thread: {
          id: threadId,
          updatedAt,
          lastVisitedAt: "2026-10-17T11:59:59.000Z",
          latestRunCompletedAt: updatedAt,
        },
        lastDispatchedKey: `${threadId}:2026-10-17T11:59:59.000Z`,
        lastDispatchAt: now - 1_000,
        now,
      }),
      { kind: "now", key: `${threadId}:${updatedAt}`, visitedAt: updatedAt },
    );
  });

  it("holds other activity's visit until ten seconds after the last one", () => {
    assert.strictEqual(VISIT_DISPATCH_THROTTLE_MS, 10_000);
    assert.deepStrictEqual(
      resolveThreadVisit({
        thread: {
          id: threadId,
          updatedAt,
          lastVisitedAt: "2026-10-17T11:59:59.000Z",
          latestRunCompletedAt: "2026-10-17T11:59:58.000Z",
        },
        lastDispatchedKey: `${threadId}:2026-10-17T11:59:59.000Z`,
        lastDispatchAt: now - 4_000,
        now,
      }),
      { kind: "later", delayMs: 6_000, key: `${threadId}:${updatedAt}`, visitedAt: updatedAt },
    );
  });
});

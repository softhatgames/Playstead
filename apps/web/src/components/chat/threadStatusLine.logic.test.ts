import { assert, describe, it } from "@effect/vitest";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

import { resolveThreadStatusLine } from "./threadStatusLine.logic.ts";

/**
 * The line above the composer that says the thread in view is snoozed,
 * settled or woke from a snooze (T3 Code's `threadStatusLine` in
 * `apps/web/src/components/ChatView.tsx` at 2577baf).
 */

type StatusShell = Parameters<typeof resolveThreadStatusLine>[0]["thread"];

const shell = (overrides: Partial<OrchestrationV2ThreadShell> = {}): StatusShell => ({
  status: "completed",
  latestRunCompletedAt: "2026-10-17T00:30:00.000Z",
  lastVisitedAt: "2026-10-17T00:30:00.000Z",
  settledOverride: null,
  settledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  hasPendingUserInput: false,
  ...overrides,
});

const now = Date.parse("2026-10-17T12:00:00.000Z");
const line = (overrides: Partial<OrchestrationV2ThreadShell> = {}) =>
  resolveThreadStatusLine({ thread: shell(overrides), now });

describe("the thread view's status line", () => {
  it("says nothing for a thread at work as usual", () => {
    assert.isNull(line());
  });

  it("says a snoozed thread is snoozed and how long is left, with Wake now", () => {
    assert.deepStrictEqual(
      line({ snoozedAt: "2026-10-17T11:00:00.000Z", snoozedUntil: "2026-10-17T14:30:00.000Z" }),
      { kind: "snoozed", label: "Snoozed, 2h left", action: "Wake now" },
    );
    assert.deepStrictEqual(
      line({ snoozedAt: "2026-10-17T11:00:00.000Z", snoozedUntil: "2026-10-17T12:00:03.000Z" }),
      { kind: "snoozed", label: "Snoozed, Soon", action: "Wake now" },
    );
  });

  it("says when a settled thread settled, with Un-settle", () => {
    assert.deepStrictEqual(
      line({ settledOverride: "settled", settledAt: "2026-10-17T09:00:00.000Z" }),
      { kind: "settled", label: "Settled 3h ago", action: "Un-settle" },
    );
    assert.deepStrictEqual(line({ settledOverride: "settled", settledAt: null }), {
      kind: "settled",
      label: "Settled",
      action: "Un-settle",
    });
  });

  it("puts snoozed before settled, as a snoozed thread shows in Snoozed", () => {
    assert.strictEqual(
      line({
        settledOverride: "settled",
        settledAt: "2026-10-17T09:00:00.000Z",
        snoozedAt: "2026-10-17T11:00:00.000Z",
        snoozedUntil: "2026-10-17T14:30:00.000Z",
      })?.kind,
      "snoozed",
    );
  });

  it("says a thread woke from its snooze until it is seen after the wake, with Dismiss", () => {
    const wokeAt = "2026-10-17T11:00:00.000Z";
    assert.deepStrictEqual(line({ snoozedAt: "2026-10-17T10:00:00.000Z", snoozedUntil: wokeAt }), {
      kind: "woke",
      label: "Woke from snooze",
      action: "Dismiss",
      wokeAt,
    });
    assert.isNull(
      line({
        snoozedAt: "2026-10-17T10:00:00.000Z",
        snoozedUntil: wokeAt,
        lastVisitedAt: "2026-10-17T11:00:00.000Z",
      }),
    );
  });

  it("counts a run that ended after the wake as seeing it, as T3 Code does", () => {
    assert.isNull(
      line({
        snoozedAt: "2026-10-17T10:00:00.000Z",
        snoozedUntil: "2026-10-17T11:00:00.000Z",
        latestRunCompletedAt: "2026-10-17T11:30:00.000Z",
        lastVisitedAt: "2026-10-17T09:00:00.000Z",
      }),
    );
  });
});

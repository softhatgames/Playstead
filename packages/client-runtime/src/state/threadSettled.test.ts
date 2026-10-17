// @effect-diagnostics globalDate:off -- Snooze presets and custom times are local calendar times.
import { afterEach, assert, describe, it, vi } from "@effect/vitest";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

import {
  canSnooze,
  effectiveSnoozed,
  localSnoozeDate,
  localSnoozeTime,
  resolveCustomSnooze,
  resolveSnoozePresets,
  snoozeWakeLabel,
  threadRaisedHandWhileSnoozed,
  threadWokeAt,
  type ThreadSnoozeShell,
} from "./threadSettled.ts";

/**
 * The snooze rules the sidebar and the thread view share (T3 Code's
 * `packages/client-runtime/src/state/threadSnoozed.test.ts` and
 * `customSnooze.test.ts` at 2577baf), over Playstead's shell.
 */

const now = "2026-06-02T00:00:00.000Z";

const shell = (overrides: Partial<ThreadSnoozeShell> = {}): ThreadSnoozeShell => ({
  status: "idle" as OrchestrationV2ThreadShell["status"],
  latestRunCompletedAt: null,
  snoozedUntil: "2026-06-02T09:00:00.000Z",
  snoozedAt: "2026-06-01T23:00:00.000Z",
  hasPendingUserInput: false,
  ...overrides,
});

const localDate = (year: number, month: number, day: number, hour: number, minute = 0) =>
  new Date(year, month, day, hour, minute);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("effectiveSnoozed", () => {
  it("hides a thread whose wake time is ahead, and stops once it passes, with no event", () => {
    assert.isTrue(effectiveSnoozed(shell(), { now }));
    assert.isFalse(effectiveSnoozed(shell(), { now: "2026-06-02T09:00:00.000Z" }));
  });

  it("never snoozes a thread with no snooze, or with a malformed one", () => {
    assert.isFalse(effectiveSnoozed(shell({ snoozedUntil: null, snoozedAt: null }), { now }));
    assert.isFalse(effectiveSnoozed(shell({ snoozedUntil: "not-a-date" }), { now }));
  });

  it("wakes early when the provider waits on the person", () => {
    assert.isFalse(effectiveSnoozed(shell({ hasPendingUserInput: true }), { now }));
  });

  it("wakes early when a run completes or fails after the snooze, not before", () => {
    const after = { latestRunCompletedAt: "2026-06-01T23:30:00.000Z" };
    const before = { latestRunCompletedAt: "2026-06-01T22:00:00.000Z" };
    assert.isFalse(effectiveSnoozed(shell({ status: "completed", ...after }), { now }));
    assert.isFalse(effectiveSnoozed(shell({ status: "failed", ...after }), { now }));
    assert.isTrue(effectiveSnoozed(shell({ status: "completed", ...before }), { now }));
    assert.isTrue(effectiveSnoozed(shell({ status: "failed", ...before }), { now }));
  });

  it("stays snoozed while the run keeps working: a snooze never pauses the agent", () => {
    assert.isTrue(effectiveSnoozed(shell({ status: "running" }), { now }));
    assert.isFalse(threadRaisedHandWhileSnoozed(shell({ status: "running" })));
  });
});

describe("canSnooze", () => {
  it("allows quiet and working threads, and refuses one waiting on the person or about to start", () => {
    assert.isTrue(canSnooze(shell({ status: "completed" })));
    assert.isTrue(canSnooze(shell({ status: "running" })));
    assert.isFalse(canSnooze(shell({ status: "running", hasPendingUserInput: true })));
    assert.isFalse(canSnooze(shell({ status: "starting" })));
  });
});

describe("threadWokeAt", () => {
  it("is null for a thread never snoozed or still snoozed", () => {
    assert.isNull(threadWokeAt(shell({ snoozedUntil: null }), { now }));
    assert.isNull(threadWokeAt(shell(), { now }));
  });

  it("is the wake time once it passes, and the completion for an early wake, which stays", () => {
    assert.strictEqual(
      threadWokeAt(shell(), { now: "2026-06-02T10:00:00.000Z" }),
      "2026-06-02T09:00:00.000Z",
    );
    const early = shell({ status: "completed", latestRunCompletedAt: "2026-06-01T23:30:00.000Z" });
    assert.strictEqual(threadWokeAt(early, { now }), "2026-06-01T23:30:00.000Z");
    assert.strictEqual(
      threadWokeAt(early, { now: "2026-06-02T10:00:00.000Z" }),
      "2026-06-01T23:30:00.000Z",
    );
  });
});

describe("snoozeWakeLabel", () => {
  it("shows the time left coarsely, rounding up, and never zero while snoozed", () => {
    assert.strictEqual(snoozeWakeLabel("2026-06-02T00:30:00.000Z", { now }), "30m");
    assert.strictEqual(snoozeWakeLabel("2026-06-02T01:30:00.000Z", { now }), "2h");
    assert.strictEqual(snoozeWakeLabel("2026-06-03T02:00:00.000Z", { now }), "2d");
    assert.strictEqual(snoozeWakeLabel("2026-06-02T00:00:30.000Z", { now }), "1m");
    assert.strictEqual(snoozeWakeLabel("2026-06-01T23:59:59.000Z", { now }), "now");
    assert.strictEqual(snoozeWakeLabel("not-a-date", { now }), "now");
  });
});

describe("resolveSnoozePresets", () => {
  it("offers an hour, three hours, this evening, tomorrow morning and next week", () => {
    const presets = resolveSnoozePresets(localDate(2026, 4, 8, 10));
    assert.deepStrictEqual(
      presets.map((preset) => [preset.id, preset.label]),
      [
        ["hour", "In 1 hour"],
        ["three-hours", "In 3 hours"],
        ["evening", "This evening"],
        ["tomorrow", "Tomorrow"],
        ["next-week", "Next week"],
      ],
    );
    const at = (id: string) => presets.find((preset) => preset.id === id)!.snoozedUntil;
    assert.strictEqual(at("hour"), localDate(2026, 4, 8, 11).toISOString());
    assert.strictEqual(at("three-hours"), localDate(2026, 4, 8, 13).toISOString());
    assert.strictEqual(at("evening"), localDate(2026, 4, 8, 18).toISOString());
    assert.strictEqual(at("tomorrow"), localDate(2026, 4, 9, 9).toISOString());
    // 8 May 2026 is a Friday: next week is Monday the 11th at nine.
    assert.strictEqual(at("next-week"), localDate(2026, 4, 11, 9).toISOString());
  });

  it("drops this evening once it is less than an hour away", () => {
    assert.deepStrictEqual(
      resolveSnoozePresets(localDate(2026, 4, 8, 17, 30)).map((preset) => preset.id),
      ["hour", "three-hours", "tomorrow", "next-week"],
    );
  });

  it("drops next week on a Sunday, when it is the same Monday as tomorrow", () => {
    const presets = resolveSnoozePresets(localDate(2026, 8, 13, 7, 1));
    assert.deepStrictEqual(
      presets.map((preset) => preset.id),
      ["hour", "three-hours", "evening", "tomorrow"],
    );
    assert.strictEqual(new Date(presets.at(-1)!.snoozedUntil).getDay(), 1);
  });

  it("moves tomorrow by the calendar across a daylight saving change", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    // Clocks spring forward on 14 March 2027: tomorrow is still nine on the 14th.
    const tomorrow = resolveSnoozePresets(localDate(2027, 2, 13, 23, 30)).find(
      (preset) => preset.id === "tomorrow",
    )!;
    assert.strictEqual(tomorrow.snoozedUntil, localDate(2027, 2, 14, 9).toISOString());
  });
});

describe("resolveCustomSnooze", () => {
  const from = localDate(2026, 8, 14, 14, 30);

  it("turns a local date and time into the wake time", () => {
    assert.strictEqual(
      resolveCustomSnooze({ mode: "date", date: "2026-09-15", time: "09:15" }, from),
      localDate(2026, 8, 15, 9, 15).toISOString(),
    );
  });

  it("refuses a date and time that is not ahead or does not exist", () => {
    for (const [date, time] of [
      ["2026-09-14", "14:30"],
      ["2026-09-13", "09:00"],
      ["2027-02-29", "09:00"],
      ["2026-13-01", "09:00"],
      ["2026-09-15", "24:00"],
      ["2026-09-15", "09:60"],
      ["", "09:00"],
      ["2026-09-15", ""],
    ] as const) {
      assert.isNull(resolveCustomSnooze({ mode: "date", date, time }, from), `${date} ${time}`);
    }
  });

  it("counts a duration from when it is confirmed", () => {
    for (const [unit, amount, elapsed] of [
      ["minutes", "45", 45 * 60_000],
      ["hours", "1.5", 90 * 60_000],
      ["days", "2", 48 * 3_600_000],
    ] as const) {
      assert.strictEqual(
        resolveCustomSnooze({ mode: "duration", amount, unit }, from),
        new Date(from.getTime() + elapsed).toISOString(),
        unit,
      );
    }
  });

  it("refuses a duration that is empty, not positive or too large", () => {
    for (const amount of ["", "0", "-1", "NaN", "Infinity", "1e300"]) {
      assert.isNull(resolveCustomSnooze({ mode: "duration", amount, unit: "hours" }, from), amount);
    }
  });

  it("refuses a local time skipped by daylight saving, and counts days as 24 hours", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    assert.isNull(
      resolveCustomSnooze(
        { mode: "date", date: "2027-03-14", time: "02:30" },
        new Date("2027-03-01T00:00:00Z"),
      ),
    );
    assert.strictEqual(
      resolveCustomSnooze(
        { mode: "duration", amount: "1", unit: "days" },
        localDate(2027, 2, 13, 12),
      ),
      localDate(2027, 2, 14, 13).toISOString(),
    );
  });

  it("fills the dialog's fields with local values", () => {
    const date = localDate(2026, 0, 2, 3, 4);
    assert.strictEqual(localSnoozeDate(date), "2026-01-02");
    assert.strictEqual(localSnoozeTime(date), "03:04");
  });
});

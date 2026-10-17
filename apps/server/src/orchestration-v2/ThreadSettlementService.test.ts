import { describe, expect, it } from "@effect/vitest";
import { ProjectId, RunId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2AppThread } from "@playstead/contracts/orchestrationV2";
import * as DateTime from "effect/DateTime";

import type { ProjectionSettlementCandidate } from "./ProjectionStore.ts";
import {
  isAutoSettlementCandidate,
  isSnoozed,
  QUEUED_TURN_START_GRACE_MS,
  resolveAutoSettlementAt,
  type ThreadSnoozeState,
  threadHasQueuedTurnStart,
} from "./ThreadSettlementService.ts";

/**
 * The settlement rules as T3 Code's `ThreadSettlementService.test.ts` at
 * 2577baf checks them (`threadHasQueuedTurnStart`, `isSnoozed`,
 * `resolveAutoSettlementAt`), without the pull-request cases. The grace
 * window and snoozes are checked here: a Playstead message starts its run
 * in the same command, and snooze arrives with #38.
 */

const NOW_MS = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-06-10T12:00:00.000Z"));
const DAY_MS = 24 * 60 * 60 * 1_000;
const at = (offsetMs: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW_MS + offsetMs));

const NOT_SNOOZED: ThreadSnoozeState = {
  snoozedUntil: null,
  snoozedAt: null,
  lastSnoozeWakeAt: null,
};

const candidate = (
  overrides: Partial<ProjectionSettlementCandidate> = {},
): ProjectionSettlementCandidate => ({
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  createdAt: at(-30 * DAY_MS),
  updatedAt: at(-10 * DAY_MS),
  archivedAt: null,
  settledOverride: null,
  pinnedAt: null,
  autoSettleDisabledAt: null,
  status: "completed",
  latestRunId: null,
  latestRunRequestedAt: null,
  latestRunStartedAt: null,
  latestRunCompletedAt: null,
  latestUserMessageAt: null,
  hasPendingRuntimeRequest: false,
  hasActiveRun: false,
  thread: {} as OrchestrationV2AppThread,
  ...overrides,
});

describe("threadHasQueuedTurnStart", () => {
  it("holds a fresh message whose turn has not started, inside the grace window only", () => {
    const fresh = candidate({ latestUserMessageAt: at(-60_000), status: "idle" });
    expect(threadHasQueuedTurnStart(fresh, NOW_MS)).toBe(true);
    expect(
      threadHasQueuedTurnStart(
        candidate({ latestUserMessageAt: at(-QUEUED_TURN_START_GRACE_MS - 1), status: "idle" }),
        NOW_MS,
      ),
    ).toBe(false);
    // A clock ahead of the server's by more than the window does not hold it either.
    expect(
      threadHasQueuedTurnStart(
        candidate({ latestUserMessageAt: at(QUEUED_TURN_START_GRACE_MS + 1), status: "idle" }),
        NOW_MS,
      ),
    ).toBe(false);
    // A run asked for at the message's time is its turn.
    expect(
      threadHasQueuedTurnStart(
        candidate({
          latestUserMessageAt: at(-60_000),
          latestRunId: RunId.make("run-1"),
          latestRunRequestedAt: at(-60_000),
        }),
        NOW_MS,
      ),
    ).toBe(false);
    // An older run does not count; a failed thread is never held.
    const behindOlderRun = {
      latestUserMessageAt: at(-60_000),
      latestRunId: RunId.make("run-1"),
      latestRunRequestedAt: at(-DAY_MS),
      latestRunCompletedAt: at(-DAY_MS),
    };
    expect(threadHasQueuedTurnStart(candidate(behindOlderRun), NOW_MS)).toBe(true);
    expect(
      threadHasQueuedTurnStart(candidate({ ...behindOlderRun, status: "failed" }), NOW_MS),
    ).toBe(false);
    expect(isAutoSettlementCandidate(candidate(behindOlderRun), NOT_SNOOZED, NOW_MS)).toBe(false);
  });
});

describe("resolveAutoSettlementAt", () => {
  const inactive = candidate({
    latestRunId: RunId.make("run-1"),
    latestUserMessageAt: at(-5 * DAY_MS),
    latestRunRequestedAt: at(-5 * DAY_MS),
    latestRunStartedAt: at(-5 * DAY_MS + 1_000),
    latestRunCompletedAt: at(-4 * DAY_MS),
  });

  it("settles at the latest activity once the days have passed, and never without activity", () => {
    expect(
      resolveAutoSettlementAt({
        thread: inactive,
        snooze: NOT_SNOOZED,
        nowMs: NOW_MS,
        autoSettleAfterDays: 3,
      }),
    ).toBe(at(-4 * DAY_MS));
    expect(
      resolveAutoSettlementAt({
        thread: inactive,
        snooze: NOT_SNOOZED,
        nowMs: NOW_MS,
        autoSettleAfterDays: 5,
      }),
    ).toBeNull();
    expect(
      resolveAutoSettlementAt({
        thread: inactive,
        snooze: NOT_SNOOZED,
        nowMs: NOW_MS,
        autoSettleAfterDays: null,
      }),
    ).toBeNull();
    expect(
      resolveAutoSettlementAt({
        thread: candidate(),
        snooze: NOT_SNOOZED,
        nowMs: NOW_MS,
        autoSettleAfterDays: 1,
      }),
    ).toBeNull();
  });

  it.each(["manual", "timer"] as const)("restarts the inactivity on a %s snooze wake", (wake) => {
    const snooze: ThreadSnoozeState =
      wake === "manual"
        ? { snoozedUntil: null, snoozedAt: null, lastSnoozeWakeAt: at(-2 * DAY_MS) }
        : { snoozedUntil: at(-2 * DAY_MS), snoozedAt: at(-4 * DAY_MS), lastSnoozeWakeAt: null };
    expect(
      resolveAutoSettlementAt({ thread: inactive, snooze, nowMs: NOW_MS, autoSettleAfterDays: 3 }),
    ).toBeNull();
    expect(
      resolveAutoSettlementAt({ thread: inactive, snooze, nowMs: NOW_MS, autoSettleAfterDays: 1 }),
    ).toBe(at(-2 * DAY_MS));
  });
});

describe("snoozed threads", () => {
  const snooze: ThreadSnoozeState = {
    snoozedUntil: at(DAY_MS),
    snoozedAt: at(-2 * DAY_MS),
    lastSnoozeWakeAt: null,
  };

  it("stay parked until their work completes or fails after the snooze", () => {
    const before = candidate({ latestRunCompletedAt: at(-3 * DAY_MS) });
    expect(isSnoozed(before, snooze, NOW_MS)).toBe(true);
    expect(isAutoSettlementCandidate(before, snooze, NOW_MS)).toBe(false);

    const completedSince = candidate({ latestRunCompletedAt: at(-DAY_MS) });
    expect(isSnoozed(completedSince, snooze, NOW_MS)).toBe(false);
    expect(isAutoSettlementCandidate(completedSince, snooze, NOW_MS)).toBe(true);

    const interruptedSince = candidate({
      status: "interrupted",
      latestRunCompletedAt: at(-DAY_MS),
    });
    expect(isSnoozed(interruptedSince, snooze, NOW_MS)).toBe(true);

    expect(isSnoozed(candidate({ hasPendingRuntimeRequest: true }), snooze, NOW_MS)).toBe(false);
    expect(isSnoozed(candidate(), { ...snooze, snoozedUntil: at(-1) }, NOW_MS)).toBe(false);
  });
});

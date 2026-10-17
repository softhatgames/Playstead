import type { OrchestrationV2AppThread } from "@playstead/contracts/orchestrationV2";
import * as DateTime from "effect/DateTime";
import type * as ProjectionStore from "./ProjectionStore.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * How long a fresh message holds its thread back while its turn has not
 * started (T3 Code's `QUEUED_TURN_START_GRACE_MS`).
 */
export const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

const toMillis = (value: string | null): number | null =>
  value === null ? null : DateTime.toEpochMillis(DateTime.makeUnsafe(value));

const latestMillis = (values: ReadonlyArray<number | null>): number | null =>
  values.reduce<number | null>(
    (latest, value) => (value !== null && (latest === null || value > latest) ? value : latest),
    null,
  );

/** What a snooze says about the thread: until when, since when, and its last wake. */
export interface ThreadSnoozeState {
  readonly snoozedUntil: string | null;
  readonly snoozedAt: string | null;
  readonly lastSnoozeWakeAt: string | null;
}

/** The thread's snooze: until when, since when, and when it was last woken. */
export const snoozeStateOf = (thread: OrchestrationV2AppThread): ThreadSnoozeState => ({
  snoozedUntil: thread.snoozedUntil,
  snoozedAt: thread.snoozedAt,
  lastSnoozeWakeAt: thread.lastSnoozeWakeAt,
});

type Candidate = ProjectionStore.ProjectionSettlementCandidate;

/**
 * Whether the person's latest message is still waiting for its turn to
 * start, within the grace window either side of now (T3 Code's
 * `threadHasQueuedTurnStart`): the window bounds clock skew, and a message
 * older than it no longer holds the thread.
 */
export function threadHasQueuedTurnStart(
  thread: Pick<
    Candidate,
    | "latestUserMessageAt"
    | "latestRunId"
    | "latestRunRequestedAt"
    | "latestRunStartedAt"
    | "latestRunCompletedAt"
    | "status"
  >,
  nowMs: number,
): boolean {
  const messageAtMs = toMillis(thread.latestUserMessageAt);
  if (messageAtMs === null || thread.status === "failed") return false;
  const age = nowMs - messageAtMs;
  if (Number.isNaN(age) || Math.abs(age) > QUEUED_TURN_START_GRACE_MS) return false;
  if (thread.latestRunId === null) return true;
  return [
    toMillis(thread.latestRunRequestedAt),
    toMillis(thread.latestRunStartedAt),
    toMillis(thread.latestRunCompletedAt),
  ].every((value) => value === null || value < messageAtMs);
}

/**
 * Whether the thread is still snoozed (T3 Code's `isSnoozed`, the server twin
 * of the sidebar's): until its wake time, unless it waits on the person, or
 * its latest run completed or failed after it was snoozed.
 */
export function isSnoozed(
  thread: Pick<Candidate, "latestRunCompletedAt" | "status" | "hasPendingRuntimeRequest">,
  snooze: ThreadSnoozeState,
  nowMs: number,
): boolean {
  const snoozedUntilMs = toMillis(snooze.snoozedUntil);
  if (snoozedUntilMs === null || snoozedUntilMs <= nowMs) return false;
  if (thread.hasPendingRuntimeRequest) return false;
  const snoozedAtMs = toMillis(snooze.snoozedAt);
  const completedAtMs = toMillis(thread.latestRunCompletedAt);
  const completedSince =
    snoozedAtMs !== null && completedAtMs !== null && completedAtMs > snoozedAtMs;
  const wokeOnError = thread.status === "failed" && (snoozedAtMs === null || completedSince);
  const wokeOnCompletion = thread.status === "completed" && completedSince;
  return !wokeOnError && !wokeOnCompletion;
}

/**
 * Whether automatic settlement may settle the thread at all (T3 Code's
 * `isAutoSettlementCandidate`): not archived, not settled or un-settled by
 * the person, not pinned or opted out, not waiting on the person, not
 * working, not holding a fresh message, and not snoozed unless its work woke
 * it early.
 */
export function isAutoSettlementCandidate(
  thread: Candidate,
  snooze: ThreadSnoozeState,
  nowMs: number,
): boolean {
  if (thread.archivedAt !== null || thread.settledOverride !== null) return false;
  if (thread.pinnedAt !== null || thread.autoSettleDisabledAt !== null) return false;
  if (thread.hasPendingRuntimeRequest || thread.hasActiveRun) return false;
  if (threadHasQueuedTurnStart(thread, nowMs)) return false;
  const snoozedUntilMs = toMillis(snooze.snoozedUntil);
  if (snoozedUntilMs === null || snoozedUntilMs <= nowMs) return true;
  const snoozedAtMs = toMillis(snooze.snoozedAt);
  const completedAtMs = toMillis(thread.latestRunCompletedAt);
  const completedSince =
    snoozedAtMs !== null && completedAtMs !== null && completedAtMs > snoozedAtMs;
  const wokeOnError = thread.status === "failed" && (snoozedAtMs === null || completedSince);
  return wokeOnError || completedSince;
}

/**
 * When the thread settles, or null (T3 Code's `resolveAutoSettlementAt`,
 * inactivity only: Playstead has no pull requests). Its last activity is the
 * latest of the person's message and the latest run's request, start and
 * completion; a snooze's wake starts the inactivity again. A thread that has
 * had none, or whose inactivity is shorter than the setting's days, stays.
 * It settles at its last activity.
 */
export function resolveAutoSettlementAt(input: {
  readonly thread: Candidate;
  readonly snooze: ThreadSnoozeState;
  readonly nowMs: number;
  readonly autoSettleAfterDays: number | null;
}): string | null {
  const { thread, snooze, nowMs } = input;
  if (!isAutoSettlementCandidate(thread, snooze, nowMs)) return null;
  const activityAtMs = latestMillis([
    toMillis(thread.latestUserMessageAt),
    toMillis(thread.latestRunRequestedAt),
    toMillis(thread.latestRunStartedAt),
    toMillis(thread.latestRunCompletedAt),
  ]);
  if (input.autoSettleAfterDays === null || activityAtMs === null) return null;
  const snoozedUntilMs = toMillis(snooze.snoozedUntil);
  const timerWakeAtMs = snoozedUntilMs !== null && snoozedUntilMs <= nowMs ? snoozedUntilMs : null;
  const inactivityAtMs =
    latestMillis([activityAtMs, toMillis(snooze.lastSnoozeWakeAt), timerWakeAtMs]) ?? activityAtMs;
  return inactivityAtMs < nowMs - input.autoSettleAfterDays * DAY_MS
    ? DateTime.formatIso(DateTime.makeUnsafe(inactivityAtMs))
    : null;
}

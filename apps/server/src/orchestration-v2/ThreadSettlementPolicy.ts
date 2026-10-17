import {
  ACTIVE_RUN_STATUSES,
  QUEUED_RUN_STATUSES,
  type OrchestrationV2ThreadProjection,
} from "@playstead/contracts/orchestrationV2";
import * as DateTime from "effect/DateTime";

/** Rechecked under the command lock, including the two-minute queued-start grace. */
export function isAutoSettlementCandidate(
  projection: OrchestrationV2ThreadProjection,
  now: number,
): boolean {
  const { thread, runs, messages, runtimeRequests } = projection;
  if (
    thread.archivedAt !== null ||
    thread.deletedAt !== null ||
    thread.settledOverride !== null ||
    thread.pinnedAt !== null ||
    thread.autoSettleDisabledAt != null ||
    runtimeRequests.some((request) => request.status === "pending") ||
    runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status) || QUEUED_RUN_STATUSES.has(run.status))
  )
    return false;
  const userTimes = messages
    .filter((message) => message.role === "user")
    .map((message) => Date.parse(message.createdAt));
  const latestMessage = Math.max(...userTimes);
  const latestRun = runs.reduce<(typeof runs)[number] | undefined>(
    (latest, run) => (latest === undefined || run.ordinal > latest.ordinal ? run : latest),
    undefined,
  );
  if (
    latestRun?.status !== "failed" &&
    Math.abs(now - latestMessage) <= 120_000 &&
    (latestRun === undefined ||
      [latestRun.requestedAt, latestRun.startedAt, latestRun.completedAt].every(
        (time) => time === null || Date.parse(time) < latestMessage,
      ))
  )
    return false;
  if (thread.snoozedUntil !== null && Date.parse(thread.snoozedUntil) > now) {
    const completed = latestRun?.completedAt;
    const returned =
      completed != null &&
      thread.snoozedAt !== null &&
      Date.parse(completed) > Date.parse(thread.snoozedAt);
    if (!returned) return false;
  }
  return true;
}

/** Inactivity rules studied in T3 Code's ThreadSettlementService.ts at 2577baf.
 * Creation, visits and metadata edits are not conversation activity. */
export function settlementAt(
  projection: OrchestrationV2ThreadProjection,
  now: number,
  days: number | null,
): string | null {
  const { thread, runs, messages } = projection;
  if (!isAutoSettlementCandidate(projection, now)) return null;
  if (days === null) return null;
  const userTimes = messages
    .filter((message) => message.role === "user")
    .map((message) => Date.parse(message.createdAt));
  const runTimes = runs
    .flatMap((run) => [run.requestedAt, run.startedAt, run.completedAt])
    .filter((time) => time !== null)
    .map(Date.parse);
  const activity = Math.max(...userTimes, ...runTimes);
  if (!Number.isFinite(activity)) return null;
  const timerWake =
    thread.snoozedUntil !== null && Date.parse(thread.snoozedUntil) <= now
      ? Date.parse(thread.snoozedUntil)
      : -Infinity;
  const inactivity = Math.max(
    activity,
    timerWake,
    thread.lastSnoozeWakeAt === null ? -Infinity : Date.parse(thread.lastSnoozeWakeAt),
  );
  return inactivity < now - days * 86_400_000
    ? DateTime.formatIso(DateTime.makeUnsafe(inactivity))
    : null;
}

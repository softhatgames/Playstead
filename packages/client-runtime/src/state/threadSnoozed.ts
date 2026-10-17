/**
 * Derived snooze state, following T3 Code's state/threadSettled.ts at
 * 2577baf. Expiry and an agent returning control wake without a timer or
 * a mutation. Keep the early wake authoritative after the deadline.
 */
export interface SnoozeState {
  readonly snoozedUntil: string | null;
  readonly snoozedAt: string | null;
  readonly latestRunCompletedAt: string | null;
  readonly status: string;
}

export function threadWokeAt(thread: SnoozeState, now: string): string | null {
  if (thread.snoozedUntil === null) return null;
  const completed = thread.latestRunCompletedAt;
  if (thread.status === "waiting") return completed ?? thread.snoozedAt;
  if (
    (thread.status === "completed" || thread.status === "failed") &&
    completed !== null &&
    thread.snoozedAt !== null &&
    Date.parse(completed) > Date.parse(thread.snoozedAt)
  )
    return completed;
  return Date.parse(thread.snoozedUntil) <= Date.parse(now) ? thread.snoozedUntil : null;
}

export function effectiveSnoozed(thread: SnoozeState, now: string): boolean {
  return (
    thread.snoozedUntil !== null &&
    Date.parse(thread.snoozedUntil) > Date.parse(now) &&
    thread.status !== "waiting" &&
    threadWokeAt(thread, now) === null
  );
}

/** Working runs can be snoozed; a pending question cannot. The server checks all requests/queues. */
export const canSnooze = (thread: { readonly status: string }): boolean =>
  thread.status !== "waiting" && thread.status !== "queued";

// @effect-diagnostics globalDate:off -- Snooze presets use local calendar boundaries and Intl labels.
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

/**
 * Snooze as the interface sees it (T3 Code's
 * `packages/client-runtime/src/state/threadSettled.ts` at 2577baf, over
 * Playstead's shell). There is no timer: a thread is snoozed while its wake
 * time is ahead, and it wakes early when it raises its hand, as the server's
 * `isThreadSnoozed` decides too.
 */

export type ThreadSnoozeShell = Pick<
  OrchestrationV2ThreadShell,
  "status" | "latestRunCompletedAt" | "snoozedUntil" | "snoozedAt" | "hasPendingUserInput"
>;

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const EVENING_HOUR = 18;
const MORNING_HOUR = 9;

const millisOf = (iso: string | null): number => (iso === null ? Number.NaN : Date.parse(iso));

/** The latest run completed after the snooze, so its result is news. */
const completedSinceSnooze = (shell: ThreadSnoozeShell): boolean =>
  shell.status === "completed" && millisOf(shell.latestRunCompletedAt) > millisOf(shell.snoozedAt);

/**
 * The snoozed thread needs the person (T3 Code's
 * `threadRaisedHandWhileSnoozed`): a provider waits on an answer, or its
 * latest run completed or failed after it was snoozed. A run that ended
 * before was already seen.
 */
export function threadRaisedHandWhileSnoozed(shell: ThreadSnoozeShell): boolean {
  if (shell.hasPendingUserInput) return true;
  if (
    shell.status === "failed" &&
    (shell.snoozedAt === null || millisOf(shell.latestRunCompletedAt) > millisOf(shell.snoozedAt))
  ) {
    return true;
  }
  return completedSinceSnooze(shell);
}

/**
 * Whether the thread may be snoozed now (T3 Code's `canSnooze`): not while
 * a provider waits on the person, nor while a message waits to start its
 * turn (T3 Code's queued turn start; Playstead's run is `starting` then).
 * A working thread may be snoozed: a snooze never pauses the agent.
 */
export function canSnooze(shell: Pick<ThreadSnoozeShell, "status" | "hasPendingUserInput">) {
  return !shell.hasPendingUserInput && shell.status !== "starting";
}

/** Whether the thread shows as snoozed at `now` (T3 Code's `effectiveSnoozed`). */
export function effectiveSnoozed(
  shell: ThreadSnoozeShell,
  options: { readonly now: string },
): boolean {
  const wakeAt = millisOf(shell.snoozedUntil);
  if (Number.isNaN(wakeAt) || wakeAt <= Date.parse(options.now)) return false;
  return !threadRaisedHandWhileSnoozed(shell);
}

/**
 * When the thread woke from its snooze, or null while it sleeps or was never
 * snoozed (T3 Code's `threadWokeAt`). An early wake keeps its time after the
 * snooze's own time passes.
 */
export function threadWokeAt(
  shell: ThreadSnoozeShell,
  options: { readonly now: string },
): string | null {
  const wakeAt = millisOf(shell.snoozedUntil);
  if (Number.isNaN(wakeAt)) return null;
  if (threadRaisedHandWhileSnoozed(shell)) {
    // A run that ended since is the wake; a question has no time of its own
    // in the shell (T3 Code reads the session's), so the snooze stands in.
    if (shell.hasPendingUserInput) return shell.snoozedAt;
    return shell.latestRunCompletedAt ?? shell.snoozedAt;
  }
  return wakeAt <= Date.parse(options.now) ? shell.snoozedUntil : null;
}

export type SnoozePresetId = "hour" | "three-hours" | "evening" | "tomorrow" | "next-week";

export interface SnoozePreset {
  readonly id: SnoozePresetId;
  readonly label: string;
  /** When it wakes, as the menu shows it beside the label. */
  readonly whenLabel: string;
  readonly snoozedUntil: string;
}

const timeOfDayLabel = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function atHour(base: Date, hour: number): Date {
  const next = new Date(base.getTime());
  next.setHours(hour, 0, 0, 0);
  return next;
}

// By the calendar, not by 24 hours: a day with a daylight saving change is
// 23 or 25 hours long.
function addDays(base: Date, days: number): Date {
  const next = new Date(base.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * The menu's snooze choices at `now` (T3 Code's `resolveSnoozePresets`): in
 * an hour, in three hours, this evening at six while that is more than an
 * hour away, tomorrow at nine, and next Monday at nine unless that is
 * tomorrow.
 */
export function resolveSnoozePresets(now: Date): ReadonlyArray<SnoozePreset> {
  const preset = (id: SnoozePresetId, label: string, wake: Date, whenLabel?: string) => ({
    id,
    label,
    whenLabel: whenLabel ?? timeOfDayLabel(wake),
    snoozedUntil: wake.toISOString(),
  });
  const presets: SnoozePreset[] = [
    preset("hour", "In 1 hour", new Date(now.getTime() + HOUR_MS)),
    preset("three-hours", "In 3 hours", new Date(now.getTime() + 3 * HOUR_MS)),
  ];
  const evening = atHour(now, EVENING_HOUR);
  if (evening.getTime() - now.getTime() > HOUR_MS) {
    presets.push(preset("evening", "This evening", evening));
  }
  const tomorrow = atHour(addDays(now, 1), MORNING_HOUR);
  presets.push(preset("tomorrow", "Tomorrow", tomorrow));
  const daysUntilMonday = (1 - now.getDay() + 7) % 7 || 7;
  const nextWeek = atHour(addDays(now, daysUntilMonday), MORNING_HOUR);
  if (nextWeek.getTime() !== tomorrow.getTime()) {
    presets.push(
      preset(
        "next-week",
        "Next week",
        nextWeek,
        `${nextWeek.toLocaleDateString(undefined, { weekday: "short" })} ${timeOfDayLabel(nextWeek)}`,
      ),
    );
  }
  return presets;
}

/** A snoozed row's time left, coarse and rounded up: "30m", "2h", "3d" (T3 Code's `snoozeWakeLabel`). */
export function snoozeWakeLabel(snoozedUntil: string, options: { readonly now: string }): string {
  const remaining = Date.parse(snoozedUntil) - Date.parse(options.now);
  if (Number.isNaN(remaining) || remaining <= 0) return "now";
  if (remaining < HOUR_MS) return `${Math.max(1, Math.ceil(remaining / 60_000))}m`;
  if (remaining < DAY_MS) return `${Math.ceil(remaining / HOUR_MS)}h`;
  return `${Math.ceil(remaining / DAY_MS)}d`;
}

/** What the **Custom snooze** dialog asks: a local date and time, or a duration. */
export type CustomSnoozeInput =
  | { readonly mode: "date"; readonly date: string; readonly time: string }
  | {
      readonly mode: "duration";
      readonly amount: string;
      readonly unit: "minutes" | "hours" | "days";
    };

/**
 * The wake time the dialog's answer means at `now`, or null when it is not
 * a time ahead (T3 Code's `resolveCustomSnooze`). A local time that does not
 * exist, such as one skipped by daylight saving, is refused; a duration in
 * days counts 24 hours each.
 */
export function resolveCustomSnooze(input: CustomSnoozeInput, now: Date): string | null {
  let wake: Date;
  if (input.mode === "duration") {
    const amount = Number(input.amount);
    if (input.amount.trim() === "" || !Number.isFinite(amount) || amount <= 0) return null;
    const unitMs = { minutes: 60_000, hours: HOUR_MS, days: DAY_MS }[input.unit];
    wake = new Date(now.getTime() + amount * unitMs);
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) return null;
    wake = new Date(`${input.date}T${input.time}:00`);
    if (localSnoozeDate(wake) !== input.date || localSnoozeTime(wake) !== input.time) return null;
  }
  return Number.isFinite(wake.getTime()) && wake.getTime() > now.getTime()
    ? wake.toISOString()
    : null;
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** The date input's value for `date`, in local time. */
export const localSnoozeDate = (date: Date): string =>
  `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The time input's value for `date`, in local time. */
export const localSnoozeTime = (date: Date): string =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}`;

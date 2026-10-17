// @effect-diagnostics globalDate:off -- Snooze choices follow the person's local calendar.
/** Local calendar choices, studied in T3 Code's threadSettled.ts at 2577baf. */
export type SnoozePresetId = "hour" | "three-hours" | "evening" | "tomorrow" | "next-week";
export interface SnoozePreset {
  readonly id: SnoozePresetId;
  readonly label: string;
  readonly whenLabel: string;
  readonly snoozedUntil: string;
}

const hour = 3_600_000;

export function resolveSnoozePresets(now: Date): ReadonlyArray<SnoozePreset> {
  const choices: SnoozePreset[] = [];
  const add = (id: SnoozePresetId, label: string, wake: Date) => {
    const time = wake.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    choices.push({
      id,
      label,
      whenLabel:
        id === "next-week"
          ? `${wake.toLocaleDateString(undefined, { weekday: "short" })} ${time}`
          : time,
      snoozedUntil: wake.toISOString(),
    });
  };
  const calendar = (days: number, at: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, at);
  add("hour", "In 1 hour", new Date(now.getTime() + hour));
  add("three-hours", "In 3 hours", new Date(now.getTime() + 3 * hour));
  const evening = calendar(0, 18);
  if (evening.getTime() > now.getTime() + hour) add("evening", "This evening", evening);
  add("tomorrow", "Tomorrow", calendar(1, 9));
  const monday = (8 - now.getDay()) % 7 || 7;
  if (monday !== 1) add("next-week", "Next week", calendar(monday, 9));
  return choices;
}

export type CustomSnoozeInput =
  | { readonly mode: "date"; readonly date: string; readonly time: string }
  | {
      readonly mode: "duration";
      readonly amount: string;
      readonly unit: "minutes" | "hours" | "days";
    };

export const localSnoozeDate = (date: Date): string =>
  [
    date.getFullYear().toString().padStart(4, "0"),
    (date.getMonth() + 1).toString().padStart(2, "0"),
    date.getDate().toString().padStart(2, "0"),
  ].join("-");
export const localSnoozeTime = (date: Date): string =>
  [date.getHours(), date.getMinutes()].map((part) => part.toString().padStart(2, "0")).join(":");

export function resolveCustomSnooze(input: CustomSnoozeInput, now: Date): string | null {
  let milliseconds: number;
  if (input.mode === "duration") {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    milliseconds =
      now.getTime() + amount * { minutes: 60_000, hours: hour, days: 24 * hour }[input.unit];
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) return null;
    const wake = new Date(`${input.date}T${input.time}:00`);
    if (localSnoozeDate(wake) !== input.date || localSnoozeTime(wake) !== input.time) return null;
    milliseconds = wake.getTime();
  }
  const wake = new Date(milliseconds);
  return Number.isFinite(wake.getTime()) && milliseconds > now.getTime()
    ? wake.toISOString()
    : null;
}

export function snoozeWakeLabel(until: string, now: number): string {
  const remaining = Date.parse(until) - now;
  if (!(remaining > 0)) return "now";
  if (remaining < hour) return `${Math.ceil(remaining / 60_000)}m`;
  if (remaining < 24 * hour) return `${Math.ceil(remaining / hour)}h`;
  return `${Math.ceil(remaining / (24 * hour))}d`;
}

export type SnoozeMenuId = "snooze" | "unsnooze" | `snooze:${SnoozePresetId}` | "snooze:custom";

export interface SnoozeMenuState {
  readonly isSnoozed: boolean;
  readonly canSnooze: boolean;
  readonly presets: ReadonlyArray<SnoozePreset>;
}

export function buildSnoozeMenuItems(
  state: SnoozeMenuState,
): ReadonlyArray<import("@playstead/contracts/ipc").ContextMenuItem<SnoozeMenuId>> {
  if (state.isSnoozed) return [{ id: "unsnooze", label: "Wake thread" }];
  return [
    {
      id: "snooze",
      label: "Snooze",
      disabled: !state.canSnooze,
      children: [
        ...state.presets.map((preset) => ({
          id: `snooze:${preset.id}` as const,
          label: `${preset.label} (${preset.whenLabel})`,
        })),
        { id: "snooze:custom", label: "Custom…" },
      ],
    },
  ];
}

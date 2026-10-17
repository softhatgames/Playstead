import { describe, expect, it, vi } from "vite-plus/test";
import { resolveSnoozePresets, resolveCustomSnooze } from "./Sidebar.snooze.ts";

describe("Snooze times in the person's local calendar", () => {
  it("offers elapsed hours, evening at six, tomorrow at nine and next Monday at nine", () => {
    const now = new Date(2026, 9, 17, 14, 30);
    const choices = resolveSnoozePresets(now);
    expect(choices.map((choice) => choice.id)).toEqual([
      "hour",
      "three-hours",
      "evening",
      "tomorrow",
      "next-week",
    ]);
    expect(choices.map((choice) => choice.snoozedUntil)).toEqual([
      new Date(2026, 9, 17, 15, 30).toISOString(),
      new Date(2026, 9, 17, 17, 30).toISOString(),
      new Date(2026, 9, 17, 18).toISOString(),
      new Date(2026, 9, 18, 9).toISOString(),
      new Date(2026, 9, 19, 9).toISOString(),
    ]);
    expect(resolveSnoozePresets(new Date(2026, 9, 18, 17)).map((choice) => choice.id)).toEqual([
      "hour",
      "three-hours",
      "tomorrow",
    ]);
    expect(resolveSnoozePresets(new Date(2026, 9, 19, 10)).at(-1)?.snoozedUntil).toBe(
      new Date(2026, 9, 26, 9).toISOString(),
    );
  });

  it("resolves custom local dates and fractional durations, refusing invalid or past values", () => {
    const now = new Date(2026, 9, 17, 14, 30);
    expect(resolveCustomSnooze({ mode: "date", date: "2026-10-18", time: "09:15" }, now)).toBe(
      new Date(2026, 9, 18, 9, 15).toISOString(),
    );
    expect(resolveCustomSnooze({ mode: "duration", amount: "1.5", unit: "hours" }, now)).toBe(
      new Date(2026, 9, 17, 16).toISOString(),
    );
    for (const amount of ["", "0", "-1", "NaN", "Infinity", "1e999"]) {
      expect(resolveCustomSnooze({ mode: "duration", amount, unit: "minutes" }, now)).toBeNull();
    }
    for (const [date, time] of [
      ["2026-02-30", "09:00"],
      ["2026-10-17", "14:30"],
      ["2026-10-18", "24:00"],
      ["2026-1-1", "9:00"],
    ]) {
      expect(resolveCustomSnooze({ mode: "date", date: date!, time: time! }, now)).toBeNull();
    }
  });
});

it("builds the snooze submenu, disables blocked threads, and offers Wake when snoozed", async () => {
  const { buildSnoozeMenuItems } = await import("./Sidebar.snooze.ts");
  const presets = resolveSnoozePresets(new Date(2026, 9, 17, 14));
  expect(buildSnoozeMenuItems({ isSnoozed: true, canSnooze: true, presets })).toEqual([
    { id: "unsnooze", label: "Wake thread" },
  ]);
  const [menu] = buildSnoozeMenuItems({ isSnoozed: false, canSnooze: false, presets });
  expect(menu?.disabled).toBe(true);
  expect(menu?.children?.at(-1)).toEqual({ id: "snooze:custom", label: "Custom…" });
});

it("keeps calendar presets at nine across daylight-saving changes and rejects nonexistent local times", () => {
  vi.stubEnv("TZ", "America/New_York");
  try {
    const now = new Date(2026, 2, 7, 23, 30);
    const tomorrow = resolveSnoozePresets(now).find((preset) => preset.id === "tomorrow");
    expect(tomorrow?.snoozedUntil).toBe("2026-03-08T13:00:00.000Z");
    expect(
      resolveCustomSnooze({ mode: "date", date: "2026-03-08", time: "02:30" }, now),
    ).toBeNull();
    expect(resolveCustomSnooze({ mode: "duration", amount: "1", unit: "days" }, now)).toBe(
      "2026-03-09T04:30:00.000Z",
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

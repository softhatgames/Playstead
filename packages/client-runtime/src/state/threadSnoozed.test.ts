import { describe, expect, it } from "vite-plus/test";
import { effectiveSnoozed, threadWokeAt } from "./threadSnoozed.ts";

const sleeping = {
  snoozedUntil: "2026-10-18T12:00:00Z",
  snoozedAt: "2026-10-17T12:00:00Z",
  latestRunCompletedAt: null,
  status: "running",
};
describe("Snoozed threads", () => {
  it("wakes on completion after snoozing, preserving that wake after the deadline", () => {
    expect(effectiveSnoozed(sleeping, "2026-10-17T13:00:00Z")).toBe(true);
    const completed = {
      ...sleeping,
      status: "completed",
      latestRunCompletedAt: "2026-10-17T12:30:00Z",
    };
    expect(effectiveSnoozed(completed, "2026-10-17T13:00:00Z")).toBe(false);
    expect(threadWokeAt(completed, "2026-10-19T13:00:00Z")).toBe("2026-10-17T12:30:00Z");
    expect(
      effectiveSnoozed(
        { ...completed, latestRunCompletedAt: sleeping.snoozedAt },
        "2026-10-17T13:00:00Z",
      ),
    ).toBe(true);
    expect(effectiveSnoozed(sleeping, sleeping.snoozedUntil)).toBe(false);
  });
});

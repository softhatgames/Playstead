import { describe, expect, it } from "@effect/vitest";

import { SETTINGS_SECTION_LABELS, searchSettings } from "./settingsSearch.ts";

/**
 * Finding a setting from the command palette (T3 Code's
 * `apps/web/src/components/settings/settingsSearch.ts` at 2577baf), over
 * the rows Playstead's settings pages have.
 */

const titles = (query: string) => searchSettings(query).map((item) => item.title);

describe("settings search", () => {
  it("finds nothing until something is typed", () => {
    expect(searchSettings("   ")).toEqual([]);
  });

  it("finds a row by its title, ranking a title that starts with the query first", () => {
    expect(titles("confirmation")).toEqual(["Archive confirmation", "Delete confirmation"]);
    expect(titles("archive")).toEqual(["Archive confirmation", "Archived threads"]);
  });

  it("finds a row by the words that describe it, or by its page", () => {
    expect(titles("thread titles")).toEqual(["Text generation model"]);
    expect(titles("codex")).toEqual(["Providers"]);
    expect(titles("tree")).toEqual(["Sidebar (legacy)"]);
  });

  it("needs every word, each in some field, ranking a title holding them all first", () => {
    expect(titles("auto settle inactivity")).toEqual([
      "Days of inactivity before auto-settle",
      "Auto-settle inactive threads",
    ]);
    expect(titles("settle banana")).toEqual([]);
  });

  it("names each row's page", () => {
    const [working] = searchSettings("working section");
    expect(working?.to).toBe("/settings/general");
    expect(SETTINGS_SECTION_LABELS[working!.to]).toBe("General");
    expect(searchSettings("days of inactivity")[0]?.targetId).toBe("auto-settle-inactive-threads");
  });
});

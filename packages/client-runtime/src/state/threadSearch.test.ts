import { describe, expect, it } from "vite-plus/test";
import { searchThreads } from "./threadSearch.ts";

describe("thread search ordering", () => {
  const threads = [
    { id: "pinned", title: "World" },
    { id: "active", title: "HELLO world" },
    { id: "settled", title: "Hello again" },
    { id: "other", title: "Elsewhere" },
  ];
  it("puts titles first, keeps sidebar order within each group, and deduplicates content matches", () => {
    expect(
      searchThreads(threads, " hello ", new Set(["settled", "pinned", "active", "missing"])).map(
        (thread) => thread.id,
      ),
    ).toEqual(["active", "settled", "pinned"]);
  });
  it("matches single-character titles immediately and returns nothing for a blank query", () => {
    expect(searchThreads(threads, "w").map((thread) => thread.id)).toEqual([
      "pinned",
      "active",
      "other",
    ]);
    expect(searchThreads(threads, "  ", new Set(["active"]))).toEqual([]);
  });
  it("respects the supplied project scope even when messages match outside it", () => {
    expect(searchThreads([threads[1]!], "hello", new Set(["pinned", "settled"]))).toEqual([
      threads[1],
    ]);
  });
});

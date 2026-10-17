import { describe, expect, it } from "@effect/vitest";
import { buildPaletteGroups } from "./CommandPalette.logic.ts";

const actions = [
  {
    id: "new",
    title: "New thread",
    searchTerms: "create chat draft",
    target: { kind: "action", action: "new-thread" },
  },
  { id: "add", title: "Add project", target: { kind: "action", action: "add-project" } },
] as const;
const threads = Array.from({ length: 14 }, (_, index) => ({
  id: `thread:${index}`,
  title: `Thread ${index}`,
  projectId: "project:one",
  updatedAt: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
  createdAt: "2026-09-01T00:00:00Z",
  archivedAt: null,
  deletedAt: null,
}));
const input = {
  query: "",
  mode: "root",
  actions,
  projects: [],
  threads,
  messageMatches: [],
} as const;

describe("command palette", () => {
  it("opens with actions and the twelve most recently active threads, excluding archived and deleted threads", () => {
    const groups = buildPaletteGroups({
      ...input,
      threads: [
        ...threads,
        { ...threads[0]!, id: "archived", archivedAt: "2026-10-17T00:00:00Z" },
        { ...threads[0]!, id: "deleted", deletedAt: "2026-10-17T00:00:00Z" },
      ],
    });
    expect(groups.map((group) => group.label)).toEqual(["Actions", "Recent Threads"]);
    expect(groups[1]!.items.map((item) => item.id)).toEqual([
      "thread:13",
      "thread:12",
      "thread:11",
      "thread:10",
      "thread:9",
      "thread:8",
      "thread:7",
      "thread:6",
      "thread:5",
      "thread:4",
      "thread:3",
      "thread:2",
    ]);
  });
});

it("searches actions by every token and keeps > searches free of threads, projects and settings", () => {
  expect(
    buildPaletteGroups({ ...input, query: ">  DRAFT new " }).map((group) => [
      group.label,
      group.items.map((item) => item.id),
    ]),
  ).toEqual([["Actions", ["new"]]]);
  expect(buildPaletteGroups({ ...input, query: ">" }).map((group) => group.label)).toEqual([
    "Actions",
  ]);
  expect(buildPaletteGroups({ ...input, query: ">nothing" })).toEqual([]);
});

it("replaces recents with matching projects, settings and title-first message results without duplicates", () => {
  const groups = buildPaletteGroups({
    ...input,
    query: "archive",
    projects: [
      { id: "project:one", title: "Archive game", workspaceRoot: "/games/archive" },
      { id: "project:two", title: "Other", workspaceRoot: "/games/other" },
    ],
    threads: [
      { ...threads[0]!, title: "Archive UI" },
      { ...threads[1]!, title: "Investigate storage" },
      { ...threads[2]!, title: "Unrelated" },
    ],
    messageMatches: [
      { threadId: "thread:0", snippet: "archive it" },
      { threadId: "thread:1", snippet: "restore from archive" },
      { threadId: "missing", snippet: "archive" },
    ],
  });
  expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
    ["Projects", ["project:one"]],
    ["Settings", ["settings:/settings/archived"]],
    ["Threads", ["thread:0", "thread:1"]],
  ]);
  expect(groups[2]!.items[1]!.description).toContain("restore from archive");
});

it("keeps a projects submenu scoped to projects, filtering titles and paths in supplied order", () => {
  const submenu = {
    ...input,
    mode: "new-thread-in",
    projects: [
      { id: "two", title: "Second", workspaceRoot: "/games/second" },
      { id: "one", title: "First", workspaceRoot: "/games/first" },
    ],
  } as const;
  expect(
    buildPaletteGroups(submenu).map((group) => [group.label, group.items.map((item) => item.id)]),
  ).toEqual([["Projects", ["two", "one"]]]);
  expect(
    buildPaletteGroups({ ...submenu, query: "games FIRST" })[0]!.items.map((item) => item.id),
  ).toEqual(["one"]);
  expect(buildPaletteGroups({ ...submenu, query: "archive" })).toEqual([]);
});

it("honors creation order when selected and carries the pending-title marker into palette results", () => {
  const groups = buildPaletteGroups({
    ...input,
    sortOrder: "created_at",
    threads: [
      {
        ...threads[0]!,
        createdAt: "2026-10-16T00:00:00Z",
        titleRegeneration: { requestId: "title:pending" },
      },
      { ...threads[1]!, createdAt: "2026-10-01T00:00:00Z" },
    ],
  });
  expect(groups[1]!.items.map((item) => item.id)).toEqual(["thread:0", "thread:1"]);
  expect(groups[1]!.items[0]!.titlePending).toBe(true);
});

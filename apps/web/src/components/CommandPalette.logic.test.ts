import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";

import {
  buildCommandPaletteRows,
  buildProjectActionItems,
  buildRootGroups,
  buildThreadActionItems,
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  enumerateCommandPaletteItems,
  filterCommandPaletteGroups,
  findHighlightedCommandPaletteItem,
  formatRelativeTimeLabel,
  getCommandPaletteInputPlaceholder,
  getCommandPaletteMode,
  RECENT_THREAD_LIMIT,
  reduceCommandPaletteUiState,
} from "./CommandPalette.logic.ts";

/**
 * The command palette's grouping and filtering (T3 Code's
 * `apps/web/src/components/CommandPalette.logic.ts` and its tests at
 * 2577baf), as behaviour: the root's Actions and Recent Threads, the
 * Projects, Settings and Threads groups a search adds, `>` for actions
 * only, a submenu searching its own items, how matches rank, and the
 * shortcuts and highlight the list carries.
 */

const NOW = Date.parse("2026-10-17T12:00:00.000Z");
const SPACE = ProjectId.make("project:space");
const ROCKET = ProjectId.make("project:rocket");
const projectTitleById = new Map<string, string>([
  [SPACE, "Space game"],
  [ROCKET, "Rocket game"],
]);

const thread = (
  id: string,
  title: string,
  overrides: Partial<{
    projectId: ProjectId;
    createdAt: string;
    updatedAt: string;
    latestRunRequestedAt: string | null;
  }> = {},
) => ({
  id: ThreadId.make(id),
  projectId: SPACE,
  title,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  latestRunRequestedAt: null,
  ...overrides,
});

const run = async () => undefined;

const action = (value: string, searchTerms: ReadonlyArray<string>): CommandPaletteActionItem => ({
  kind: "action",
  value,
  searchTerms,
  title: searchTerms[0] ?? value,
  icon: "settings",
  run,
});

const threadItems = (threads: ReadonlyArray<ReturnType<typeof thread>>, extra = {}) =>
  buildThreadActionItems({
    threads,
    projectTitleById,
    sortOrder: "updated_at",
    now: NOW,
    runThread: run,
    ...extra,
  });

const values = (groups: ReadonlyArray<CommandPaletteGroup>) =>
  groups.map((group) => [group.value, group.items.map((item) => item.value)]);

const search = (
  query: string,
  input: Partial<Parameters<typeof filterCommandPaletteGroups>[0]> = {},
) =>
  filterCommandPaletteGroups({
    activeGroups: [],
    query,
    isInSubmenu: false,
    projectSearchItems: [],
    settingsSearchItems: [],
    threadSearchItems: [],
    ...input,
  });

describe("the root of the palette", () => {
  it("shows Actions, then Recent Threads, while nothing is typed", () => {
    const actions = [action("action:settings", ["Open settings"])];
    const recent = threadItems([thread("thread:a", "Jump higher")]);
    const groups = buildRootGroups({ actionItems: actions, recentThreadItems: recent });
    expect(groups.map((group) => [group.value, group.label])).toEqual([
      ["actions", "Actions"],
      ["recent-threads", "Recent Threads"],
    ]);
    expect(values(search("", { activeGroups: groups }))).toEqual([
      ["actions", ["action:settings"]],
      ["recent-threads", ["thread:thread:a"]],
    ]);
  });

  it("leaves out a group with nothing in it", () => {
    expect(buildRootGroups({ actionItems: [], recentThreadItems: [] })).toEqual([]);
  });
});

describe("recent threads", () => {
  it("are the latest twelve by the last message sent, each with its project and age", () => {
    const threads = Array.from({ length: 14 }, (_, index) =>
      thread(`thread:${index}`, `Thread ${index}`, {
        updatedAt: `2026-10-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
      }),
    );
    const items = threadItems(threads, { limit: RECENT_THREAD_LIMIT });
    expect(items).toHaveLength(12);
    expect(items[0]?.value).toBe("thread:thread:13");
    expect(items[0]?.timestamp).toBe("3d ago");
    expect(items[0]?.description).toBe("Space game");
    expect(items.at(-1)?.value).toBe("thread:thread:2");
  });

  it("order by the latest message even when another thread changed later", () => {
    const items = threadItems([
      thread("thread:busy", "Busy", {
        updatedAt: "2026-10-17T11:00:00.000Z",
        latestRunRequestedAt: "2026-10-15T12:00:00.000Z",
      }),
      thread("thread:asked", "Asked", {
        updatedAt: "2026-10-16T12:00:00.000Z",
        latestRunRequestedAt: "2026-10-16T12:00:00.000Z",
      }),
    ]);
    expect(items.map((item) => item.value)).toEqual(["thread:thread:asked", "thread:thread:busy"]);
    expect(items[1]?.timestamp).toBe("2d ago");
  });

  it("mark the thread in view as the current one", () => {
    const [item] = threadItems([thread("thread:a", "Jump higher")], {
      activeThreadId: "thread:a",
    });
    expect(item?.description).toBe("Space game · Current thread");
  });
});

describe("searching from the root", () => {
  const actions = [
    action("action:new-thread-in", ["New thread in...", "new thread", "project"]),
    action("action:settings", ["Open settings", "settings", "preferences"]),
  ];
  const recent = threadItems([thread("thread:a", "Gravity settings")]);
  const root = buildRootGroups({ actionItems: actions, recentThreadItems: recent });
  const projects = buildProjectActionItems({
    projects: [
      { id: SPACE, title: "Space game", workspaceRoot: "/games/space" },
      { id: ROCKET, title: "Rocket game", workspaceRoot: "/games/rocket" },
    ],
    valuePrefix: "project",
    icon: "project",
    runProject: run,
  });
  const settings = [action("setting:archive", ["Archived threads", "Archive"])];

  it("drops Recent Threads and adds Projects, Settings and Threads after the actions", () => {
    const groups = search("settings", {
      activeGroups: root,
      projectSearchItems: projects,
      settingsSearchItems: [
        action("setting:general", ["Working section (beta)", "General settings"]),
      ],
      threadSearchItems: recent,
    });
    expect(values(groups)).toEqual([
      ["actions", ["action:settings"]],
      ["settings-search", ["setting:general"]],
      ["threads-search", ["thread:thread:a"]],
    ]);
  });

  it("finds a project by its title or folder", () => {
    expect(values(search("rocket", { activeGroups: root, projectSearchItems: projects }))).toEqual([
      ["projects-search", ["project:project:rocket"]],
    ]);
    expect(
      values(search("games/space", { activeGroups: root, projectSearchItems: projects })),
    ).toEqual([["projects-search", ["project:project:space"]]]);
  });

  it("needs every word of the query, in any order", () => {
    expect(values(search("thread new", { activeGroups: root }))).toEqual([
      ["actions", ["action:new-thread-in"]],
    ]);
    expect(search("thread banana", { activeGroups: root })).toEqual([]);
  });

  it("ignores case, accents and extra spaces", () => {
    expect(
      values(
        search("  ARCHÌVED   threads ", { activeGroups: root, settingsSearchItems: settings }),
      ),
    ).toEqual([["settings-search", ["setting:archive"]]]);
  });

  it("with `>` shows only the actions, filtered by what follows", () => {
    const input = {
      activeGroups: root,
      projectSearchItems: projects,
      settingsSearchItems: settings,
      threadSearchItems: recent,
    };
    expect(values(search(">", input))).toEqual([
      ["actions", ["action:new-thread-in", "action:settings"]],
    ]);
    expect(values(search(">settings", input))).toEqual([["actions", ["action:settings"]]]);
    expect(search(">rocket", input)).toEqual([]);
  });
});

describe("searching in a submenu", () => {
  it("filters the submenu's own items only", () => {
    const projectItems = buildProjectActionItems({
      projects: [
        { id: SPACE, title: "Space game", workspaceRoot: "/games/space" },
        { id: ROCKET, title: "Rocket game", workspaceRoot: "/games/rocket" },
      ],
      valuePrefix: "new-thread-in",
      icon: "project",
      runProject: run,
    });
    const submenu: CommandPaletteGroup = {
      value: "projects",
      label: "Projects",
      items: projectItems,
    };
    expect(
      values(
        search("rocket", {
          activeGroups: [submenu],
          isInSubmenu: true,
          projectSearchItems: projectItems,
          threadSearchItems: threadItems([thread("thread:a", "Rocket fuel")]),
        }),
      ),
    ).toEqual([["projects", ["new-thread-in:project:rocket"]]]);
  });
});

describe("how thread matches rank", () => {
  it("puts a title match before a thread matched only by its project", () => {
    const items = threadItems([
      thread("thread:context", "Fix the jump", { updatedAt: "2026-10-16T00:00:00.000Z" }),
      thread("thread:title", "Space station level", { updatedAt: "2026-10-10T00:00:00.000Z" }),
    ]);
    expect(values(search("space", { threadSearchItems: items }))).toEqual([
      ["threads-search", ["thread:thread:title", "thread:thread:context"]],
    ]);
  });

  it("orders title matches by recent activity, before a match in a message", () => {
    const items = threadItems(
      [
        thread("thread:old-prefix", "Gravity is broken in level two", {
          updatedAt: "2026-10-02T00:00:00.000Z",
        }),
        thread("thread:recent-title", "Lower the gravity", {
          updatedAt: "2026-10-15T00:00:00.000Z",
        }),
        thread("thread:message", "Fix the jump", { updatedAt: "2026-10-16T00:00:00.000Z" }),
      ],
      {
        getContentMatch: (candidate: { id: string }) =>
          candidate.id === "thread:message"
            ? { source: "user" as const, snippet: "Jumping ignores gravity", query: "gravity" }
            : undefined,
      },
    );
    expect(values(search("gravity", { threadSearchItems: items }))).toEqual([
      [
        "threads-search",
        ["thread:thread:recent-title", "thread:thread:old-prefix", "thread:thread:message"],
      ],
    ]);
  });

  it("keeps the matched message with the thread to show under its title", () => {
    const match = { source: "assistant" as const, snippet: "The bats now bounce", query: "bounce" };
    const [item] = threadItems([thread("thread:a", "Cave bats")], { getContentMatch: () => match });
    expect(item?.threadContentMatch).toEqual(match);
    expect(item?.description).toBe("Space game");
    expect(values(search("bounce", { threadSearchItems: item ? [item] : [] }))).toEqual([
      ["threads-search", ["thread:thread:a"]],
    ]);
  });

  it("finds a thread by its ID without putting it above a title match", () => {
    const items = threadItems([
      thread("thread:alpha-1234", "Unrelated work", { updatedAt: "2026-10-05T00:00:00.000Z" }),
      thread("thread:other", "Fix alpha-1234 flakes", { updatedAt: "2026-10-04T00:00:00.000Z" }),
    ]);
    expect(values(search("  ALPHA-1234 ", { threadSearchItems: items }))).toEqual([
      ["threads-search", ["thread:thread:other", "thread:thread:alpha-1234"]],
    ]);
  });

  it("puts secondary results after the others", () => {
    const groups = search("thread", {
      settingsSearchItems: [
        { ...action("setting:secondary", ["Thread shortcuts"]), secondary: true },
        action("setting:primary", ["Archived threads", "Archive"]),
      ],
    });
    expect(values(groups)).toEqual([["settings-search", ["setting:primary", "setting:secondary"]]]);
  });
});

describe("New thread in…", () => {
  it("gives the first nine projects the jump shortcuts", () => {
    const items = enumerateCommandPaletteItems(
      Array.from({ length: 10 }, (_, index) => action(`project:${index}`, [`Project ${index}`])),
    );
    expect(items.map((item) => item.shortcutCommand)).toEqual([
      "thread.jump.1",
      "thread.jump.2",
      "thread.jump.3",
      "thread.jump.4",
      "thread.jump.5",
      "thread.jump.6",
      "thread.jump.7",
      "thread.jump.8",
      "thread.jump.9",
      undefined,
    ]);
  });

  it("shows each project by its name, described by its folder", () => {
    const [item] = buildProjectActionItems({
      projects: [{ id: SPACE, title: "Space game", workspaceRoot: "/games/space" }],
      valuePrefix: "new-thread-in",
      icon: "project",
      runProject: run,
    });
    expect(item).toMatchObject({
      value: "new-thread-in:project:space",
      title: "Space game",
      description: "/games/space",
    });
  });
});

describe("the list", () => {
  const groups: ReadonlyArray<CommandPaletteGroup> = [
    {
      value: "actions",
      label: "Actions",
      items: [action("a", ["A"]), { ...action("b", ["B"]), disabled: true }],
    },
    { value: "threads", label: "Threads", items: [action("c", ["C"])] },
  ];

  it("keeps the groups' order and headings, counting only the items that can run", () => {
    const { rows, itemValues } = buildCommandPaletteRows(groups);
    expect(rows.map((row) => (row.kind === "label" ? `# ${row.label}` : row.item.value))).toEqual([
      "# Actions",
      "a",
      "b",
      "# Threads",
      "c",
    ]);
    expect(itemValues).toEqual(["a", "c"]);
  });

  it("runs the highlighted item on Enter, never a disabled one", () => {
    expect(findHighlightedCommandPaletteItem(groups, "c")?.value).toBe("c");
    expect(findHighlightedCommandPaletteItem(groups, "b")).toBeNull();
    expect(findHighlightedCommandPaletteItem(groups, null)).toBeNull();
  });
});

describe("the palette's modes", () => {
  it("is a submenu inside a view, and browses when the query is a path", () => {
    expect(getCommandPaletteMode({ inView: false, isBrowsing: false })).toBe("root");
    expect(getCommandPaletteMode({ inView: false, isBrowsing: true })).toBe("root-browse");
    expect(getCommandPaletteMode({ inView: true, isBrowsing: false })).toBe("submenu");
    expect(getCommandPaletteMode({ inView: true, isBrowsing: true })).toBe("submenu-browse");
    expect(getCommandPaletteInputPlaceholder("root")).toBe(
      "Search commands, projects, and threads...",
    );
    expect(getCommandPaletteInputPlaceholder("submenu")).toBe("Search...");
    expect(getCommandPaletteInputPlaceholder("root-browse")).toBe(
      "Enter project path (e.g. ~/projects/my-app)",
    );
  });

  it("opens and closes, carrying what it was opened for until that is shown", () => {
    const closed = { open: false, openIntent: null };
    const toggled = reduceCommandPaletteUiState(closed, { _tag: "Toggle" });
    expect(toggled).toEqual({ open: true, openIntent: null });
    expect(reduceCommandPaletteUiState(toggled, { _tag: "Toggle" })).toEqual(closed);
    const newThreadIn = reduceCommandPaletteUiState(toggled, { _tag: "OpenNewThreadIn" });
    expect(newThreadIn).toEqual({ open: true, openIntent: "new-thread-in" });
    expect(reduceCommandPaletteUiState(newThreadIn, { _tag: "ClearOpenIntent" })).toEqual(toggled);
    expect(reduceCommandPaletteUiState(closed, { _tag: "OpenAddProject" })).toEqual({
      open: true,
      openIntent: "add-project",
    });
    expect(reduceCommandPaletteUiState(newThreadIn, { _tag: "SetOpen", open: false })).toEqual(
      closed,
    );
  });
});

describe("relative times", () => {
  it("reads as just now, minutes, hours or days ago", () => {
    expect(formatRelativeTimeLabel("2026-10-17T11:59:30.000Z", NOW)).toBe("just now");
    expect(formatRelativeTimeLabel("2026-10-17T12:00:30.000Z", NOW)).toBe("just now");
    expect(formatRelativeTimeLabel("2026-10-17T11:15:00.000Z", NOW)).toBe("45m ago");
    expect(formatRelativeTimeLabel("2026-10-17T02:00:00.000Z", NOW)).toBe("10h ago");
    expect(formatRelativeTimeLabel("2026-10-10T12:00:00.000Z", NOW)).toBe("7d ago");
    expect(formatRelativeTimeLabel("not a time", NOW)).toBe("");
  });
});

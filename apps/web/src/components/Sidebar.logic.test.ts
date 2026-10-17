import { assert, describe, it } from "@effect/vitest";
import { createInboxReturnTracker } from "@playstead/client-runtime/state/threadInbox";
import { ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

import {
  buildSidebarProjectGroups,
  resolveSidebarProjectScope,
} from "../sidebarProjectGrouping.ts";
import {
  buildMultiSelectThreadContextMenuItems,
  buildSidebarSections,
  compactTimeLabel,
  hasUnseenCompletion,
  isTrailingDoubleClick,
  moveSearchHighlight,
  reorderProjects,
  resolveProjectStatusIndicator,
  resolveSidebarThreadWokeAt,
  searchSidebarThreads,
  sortTreeProjects,
  splitSearchHighlights,
  threadAfterPark,
} from "./Sidebar.logic.ts";

describe("hasUnseenCompletion", () => {
  const completedAt = "2026-10-17T12:00:00.000Z";

  it("shows the dot when the latest run completed after the thread was last visited", () => {
    assert.isTrue(
      hasUnseenCompletion({
        latestRunCompletedAt: completedAt,
        lastVisitedAt: "2026-10-17T11:59:59.999Z",
      }),
    );
  });

  it("hides it once the thread was visited at or after the completion", () => {
    for (const lastVisitedAt of [completedAt, "2026-10-17T12:00:05.000Z"]) {
      assert.isFalse(hasUnseenCompletion({ latestRunCompletedAt: completedAt, lastVisitedAt }));
    }
  });

  it("hides it while the latest run has not completed, or the thread was never visited", () => {
    assert.isFalse(
      hasUnseenCompletion({
        latestRunCompletedAt: null,
        lastVisitedAt: "2026-10-17T11:00:00.000Z",
      }),
    );
    assert.isFalse(hasUnseenCompletion({ latestRunCompletedAt: completedAt, lastVisitedAt: null }));
  });
});

describe("resolveProjectStatusIndicator", () => {
  const completedAt = "2026-10-17T12:00:00.000Z";
  const thread = (
    status: OrchestrationV2ThreadShell["status"],
    lastVisitedAt: string | null = completedAt,
  ) => ({ status, latestRunCompletedAt: completedAt, lastVisitedAt });
  const seenLongAgo = "2026-10-17T11:00:00.000Z";

  it("shows nothing for a folded project whose threads have no status", () => {
    assert.isNull(resolveProjectStatusIndicator([]));
    assert.isNull(resolveProjectStatusIndicator([thread("completed"), thread("idle")]));
  });

  it("shows the most pressing status of its threads: working before completed", () => {
    assert.strictEqual(
      resolveProjectStatusIndicator([thread("completed", seenLongAgo)]),
      "Completed",
    );
    assert.strictEqual(
      resolveProjectStatusIndicator([thread("completed", seenLongAgo), thread("running")]),
      "Working",
    );
  });
});

describe("isTrailingDoubleClick", () => {
  it("is the second click of a double-click, which must not navigate", () => {
    assert.deepStrictEqual(
      [0, 1, 2, 3].map((detail) => isTrailingDoubleClick(detail)),
      [false, false, true, true],
    );
  });
});

describe("the project tree's order", () => {
  const project = (id: string, createdAt: string, updatedAt = createdAt) => ({
    id,
    title: id,
    createdAt,
    updatedAt,
  });
  const projects = [
    project("rocket", "2026-10-01T00:00:00.000Z"),
    project("space", "2026-10-03T00:00:00.000Z"),
    project("cave", "2026-10-02T00:00:00.000Z", "2026-10-09T00:00:00.000Z"),
  ];
  const threads = [
    {
      projectId: "rocket",
      archivedAt: null,
      createdAt: "2026-10-04T00:00:00.000Z",
      updatedAt: "2026-10-04T00:00:00.000Z",
      latestRunRequestedAt: "2026-10-10T00:00:00.000Z",
    },
    {
      projectId: "space",
      archivedAt: null,
      createdAt: "2026-10-05T00:00:00.000Z",
      updatedAt: "2026-10-05T00:00:00.000Z",
      latestRunRequestedAt: null,
    },
  ];
  const ids = (list: ReadonlyArray<{ readonly id: string }>) => list.map((entry) => entry.id);

  it("sorts by the latest message, by creation, or as the person arranged them", () => {
    assert.deepStrictEqual(
      ids(sortTreeProjects({ projects, threads, sortOrder: "updated_at", projectOrder: [] })),
      ["rocket", "cave", "space"],
    );
    assert.deepStrictEqual(
      ids(sortTreeProjects({ projects, threads, sortOrder: "created_at", projectOrder: [] })),
      ["space", "rocket", "cave"],
    );
    assert.deepStrictEqual(
      ids(
        sortTreeProjects({
          projects,
          threads,
          sortOrder: "manual",
          projectOrder: ["cave", "gone", "rocket"],
        }),
      ),
      ["cave", "rocket", "space"],
    );
  });

  it("moves a dragged project to the place of the one it is dropped on", () => {
    const order = ["a", "b", "c", "d"];
    assert.deepStrictEqual(reorderProjects(order, "a", "c"), ["b", "c", "a", "d"]);
    assert.deepStrictEqual(reorderProjects(order, "d", "b"), ["a", "d", "b", "c"]);
    assert.deepStrictEqual(reorderProjects(order, "b", "b"), order);
    assert.deepStrictEqual(reorderProjects(order, "missing", "b"), order);
  });
});

describe("searchSidebarThreads", () => {
  const thread = (id: string, title: string) => ({ id, title });
  // In the sidebar's order: pinned, active, working, settled.
  const threads = [
    thread("pinned", "Rocket physics"),
    thread("active", "Level select menu"),
    thread("working", "Jump sound"),
    thread("settled", "Rocket trail particles"),
  ];

  it("lists title matches in the sidebar's order, then threads that matched by message", () => {
    assert.deepStrictEqual(
      searchSidebarThreads(threads, "  ROCKET ", new Set(["working", "active"])).map((t) => t.id),
      ["pinned", "settled", "active", "working"],
    );
  });

  it("lists a thread matched by both its title and a message once, with the title matches", () => {
    assert.deepStrictEqual(
      searchSidebarThreads(threads, "rocket", new Set(["settled", "working"])).map((t) => t.id),
      ["pinned", "settled", "working"],
    );
  });

  it("finds nothing for a blank query, and ignores message matches for threads not listed", () => {
    assert.deepStrictEqual(searchSidebarThreads(threads, "   ", new Set(["active"])), []);
    assert.deepStrictEqual(searchSidebarThreads(threads, "zz", new Set(["elsewhere"])), []);
  });
});

describe("moveSearchHighlight", () => {
  it("moves down and up through the results, wrapping at either end", () => {
    assert.deepStrictEqual(
      [
        moveSearchHighlight(0, 3, "down"),
        moveSearchHighlight(2, 3, "down"),
        moveSearchHighlight(0, 3, "up"),
        moveSearchHighlight(1, 3, "up"),
      ],
      [1, 0, 2, 0],
    );
  });
});

describe("splitSearchHighlights", () => {
  it("marks every match of the query, ignoring ASCII case, as the server matched it", () => {
    assert.deepStrictEqual(splitSearchHighlights("Jump higher, JUMP again", " jump "), [
      { text: "Jump", highlighted: true, start: 0 },
      { text: " higher, ", highlighted: false, start: 4 },
      { text: "JUMP", highlighted: true, start: 13 },
      { text: " again", highlighted: false, start: 17 },
    ]);
  });

  it("leaves the text whole when the query is blank or absent", () => {
    assert.deepStrictEqual(splitSearchHighlights("…tail end", "  "), [
      { text: "…tail end", highlighted: false, start: 0 },
    ]);
    assert.deepStrictEqual(splitSearchHighlights("…tail end", "zz"), [
      { text: "…tail end", highlighted: false, start: 0 },
    ]);
  });
});

/**
 * The inbox sidebar's logic (T3 Code's `apps/web/src/components/Sidebar.logic.ts`
 * and `packages/client-runtime/src/state/threadSort.ts` / `threadInbox.ts`
 * at 2577baf, as their tests check it): which section a thread is in, each
 * section's order, the bulk menu, and the project scope.
 */

const project = (id: string, title = id) => ({
  id: ProjectId.make(id),
  title,
  workspaceRoot: `/games/${id}`,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});

const thread = (
  id: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({
  id: ThreadId.make(id),
  projectId: ProjectId.make("space-game"),
  title: `Thread ${id}`,
  providerInstanceId: "claudeAgent",
  modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
  latestRunId: null,
  activeRunId: null,
  status: "idle",
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  latestRunRequestedAt: null,
  latestRunCompletedAt: null,
  lastVisitedAt: null,
  settledOverride: null,
  settledAt: null,
  unsettledAt: null,
  pinnedAt: null,
  pinOrderKey: null,
  activeOrderKey: null,
  snoozedUntil: null,
  snoozedAt: null,
  hasPendingUserInput: false,
  autoSettleDisabledAt: null,
  titleRegeneration: null,
  worktreePath: null,
  ...overrides,
});

const at = (hour: number) => `2026-10-17T${String(hour).padStart(2, "0")}:00:00.000Z`;

const ids = (threads: ReadonlyArray<OrchestrationV2ThreadShell>) =>
  threads.map((candidate) => candidate.id as string);

const sections = (
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  options: Partial<Parameters<typeof buildSidebarSections>[0]> = {},
) => {
  const built = buildSidebarSections({
    threads,
    scopedProjectIds: null,
    workingShelfEnabled: false,
    ...options,
  });
  return {
    pinned: ids(built.pinned),
    active: ids(built.active),
    working: ids(built.working),
    snoozed: ids(built.snoozed),
    settled: ids(built.settled),
  };
};

describe("the Woke indicator", () => {
  const snoozedAt = at(1);
  const woke = (overrides: Partial<OrchestrationV2ThreadShell> = {}) =>
    resolveSidebarThreadWokeAt(thread("t", { snoozedAt, snoozedUntil: at(2), ...overrides }), {
      now: at(3),
    });

  it("shows on a thread whose snooze ran out until the thread is visited after its wake", () => {
    assert.strictEqual(woke(), at(2));
    assert.strictEqual(woke({ lastVisitedAt: at(1) }), at(2));
    assert.isNull(woke({ lastVisitedAt: at(2) }));
    assert.isNull(woke({ lastVisitedAt: "2026-10-17T02:30:00.000Z" }));
  });

  it("shows when a run finishing during the snooze woke it early, from the run's end", () => {
    assert.strictEqual(
      resolveSidebarThreadWokeAt(
        thread("t", {
          snoozedAt,
          snoozedUntil: at(9),
          status: "completed",
          latestRunCompletedAt: "2026-10-17T01:30:00.000Z",
        }),
        { now: at(3) },
      ),
      "2026-10-17T01:30:00.000Z",
    );
  });

  it("does not show while the thread sleeps, was never snoozed, or is settled", () => {
    assert.isNull(woke({ snoozedUntil: at(9) }));
    assert.isNull(woke({ snoozedUntil: null, snoozedAt: null }));
    assert.isNull(woke({ settledOverride: "settled", settledAt: at(2) }));
  });

  it("gives way to a thread working, waiting on the person or failed, as T3 Code's row status does", () => {
    assert.isNull(woke({ status: "running" }));
    assert.isNull(woke({ hasPendingUserInput: true }));
    assert.isNull(woke({ status: "failed", latestRunCompletedAt: at(2) }));
  });
});

describe("sidebar sections", () => {
  it("puts settled threads in Settled, pinned ones in Pinned and the rest in Active", () => {
    assert.deepStrictEqual(
      sections([
        thread("a"),
        thread("p", { pinnedAt: at(1) }),
        thread("s", { settledOverride: "settled", settledAt: at(2) }),
        thread("u", { settledOverride: "active", unsettledAt: at(3) }),
      ]),
      { pinned: ["p"], active: ["u", "a"], working: [], snoozed: [], settled: ["s"] },
    );
  });

  it("keeps a snoozed thread in Snoozed, even a settled one, until it wakes, the earliest wake first", () => {
    const snoozedAt = at(1);
    assert.deepStrictEqual(
      sections(
        [
          thread("late", { snoozedUntil: at(9), snoozedAt }),
          thread("soon", { snoozedUntil: at(5), snoozedAt }),
          thread("settled", { settledOverride: "settled", snoozedUntil: at(7), snoozedAt }),
          // Its time has passed: awake, with no event.
          thread("woke", { snoozedUntil: at(2), snoozedAt }),
          // Its run completed after the snooze: awake early.
          thread("finished", {
            snoozedUntil: at(9),
            snoozedAt,
            status: "completed",
            latestRunCompletedAt: at(2),
          }),
          // A question waits on the person: awake early.
          thread("asking", { snoozedUntil: at(9), snoozedAt, hasPendingUserInput: true }),
        ],
        { now: at(3) },
      ),
      {
        pinned: [],
        active: ["asking", "finished", "woke"],
        working: [],
        snoozed: ["soon", "settled", "late"],
        settled: [],
      },
    );
  });

  it("shows only the scoped project's threads", () => {
    assert.deepStrictEqual(
      sections([thread("a"), thread("b", { projectId: ProjectId.make("rocket-game") })], {
        scopedProjectIds: new Set([ProjectId.make("rocket-game")]),
      }).active,
      ["b"],
    );
  });

  it("orders pinned threads by order key, then keyless ones newest first", () => {
    assert.deepStrictEqual(
      sections([
        thread("old", { pinnedAt: at(1), createdAt: at(1) }),
        thread("new", { pinnedAt: at(1), createdAt: at(5) }),
        thread("m", { pinnedAt: at(1), pinOrderKey: "m" }),
        thread("c", { pinnedAt: at(1), pinOrderKey: "c" }),
      ]).pinned,
      ["c", "m", "new", "old"],
    );
  });

  it("orders active threads without an order key newest first, by creation or un-settling, above arranged ones", () => {
    assert.deepStrictEqual(
      sections([
        thread("arranged-m", { activeOrderKey: "m" }),
        thread("arranged-c", { activeOrderKey: "c" }),
        thread("created-early", { createdAt: at(1) }),
        thread("created-late", { createdAt: at(4) }),
        thread("unsettled", { createdAt: at(0), unsettledAt: at(6) }),
      ]).active,
      ["unsettled", "created-late", "created-early", "arranged-c", "arranged-m"],
    );
  });

  it("orders settled threads by when they were settled, newest first", () => {
    assert.deepStrictEqual(
      sections([
        thread("first", { settledOverride: "settled", settledAt: at(1) }),
        thread("last", { settledOverride: "settled", settledAt: at(9) }),
      ]).settled,
      ["last", "first"],
    );
  });

  it("with the Working shelf, folds working threads there by when work was sent, and orders Active by when each came back", () => {
    const built = sections(
      [
        thread("sent-early", { status: "running", latestRunRequestedAt: at(2) }),
        thread("sent-late", { status: "starting", latestRunRequestedAt: at(3) }),
        thread("asks", { status: "waiting", latestRunRequestedAt: at(4) }),
        thread("done-early", {
          status: "completed",
          latestRunRequestedAt: at(1),
          latestRunCompletedAt: at(5),
        }),
        thread("done-late", {
          status: "completed",
          latestRunRequestedAt: at(1),
          latestRunCompletedAt: at(7),
        }),
        thread("pinned-running", { status: "running", pinnedAt: at(1) }),
        // Arranged order is set aside while the shelf is on.
        thread("arranged", { activeOrderKey: "a", createdAt: at(0) }),
      ],
      { workingShelfEnabled: true },
    );
    assert.deepStrictEqual(built.working, ["sent-late", "sent-early"]);
    assert.deepStrictEqual(built.active, ["done-late", "done-early", "asks", "arranged"]);
    assert.deepStrictEqual(built.pinned, ["pinned-running"]);
  });

  it("puts a thread that stops working at the top of Active from when it was seen coming back", () => {
    const tracker = createInboxReturnTracker();
    const working = thread("came-back", {
      createdAt: at(0),
      status: "running",
      latestRunRequestedAt: at(1),
    });
    const other = thread("other", { createdAt: at(10) });
    tracker.observe([working, other], Date.parse(at(11)));
    const returned = { ...working, status: "interrupted" as const };
    tracker.observe([returned, other], Date.parse(at(12)));
    assert.deepStrictEqual(
      ids(
        buildSidebarSections({
          threads: [returned, other],
          scopedProjectIds: null,
          workingShelfEnabled: true,
          returnedAt: tracker.returnedAt,
        }).active,
      ),
      ["came-back", "other"],
    );
  });
});

describe("after settling the thread in view", () => {
  const order = ["pinned", "viewed", "next", "settled"];
  it("moves on to the next thread not settled, wrapping round, and skipping ones settled with it", () => {
    assert.strictEqual(
      threadAfterPark({ orderedIds: order, parkedIds: new Set(["settled"]), threadId: "viewed" }),
      "next",
    );
    assert.strictEqual(
      threadAfterPark({
        orderedIds: order,
        parkedIds: new Set(["settled"]),
        threadId: "viewed",
        coParkingIds: new Set(["next"]),
      }),
      "pinned",
    );
  });

  it("has no thread to move to when every other one is settled", () => {
    assert.isNull(
      threadAfterPark({
        orderedIds: ["viewed", "settled"],
        parkedIds: new Set(["settled"]),
        threadId: "viewed",
      }),
    );
  });
});

describe("a row's time", () => {
  const now = Date.parse("2026-10-17T12:00:00.000Z");
  it("reads now, minutes, hours or days since, as T3 Code's compact labels", () => {
    assert.deepStrictEqual(
      [
        "2026-10-17T11:59:30.000Z",
        "2026-10-17T11:15:00.000Z",
        "2026-10-17T07:00:00.000Z",
        "2026-10-14T12:00:00.000Z",
        "2026-10-17T12:05:00.000Z",
      ].map((iso) => compactTimeLabel(iso, now)),
      ["now", "45m", "5h", "3d", "now"],
    );
  });
});

describe("the bulk menu", () => {
  const outline = (items: ReturnType<typeof buildMultiSelectThreadContextMenuItems>) =>
    items.map((item) => [item.id, item.label, item.disabled === true, item.destructive === true]);

  it("offers T3 Code's inbox items for the selection: unpin, settle, mark unread and delete", () => {
    assert.deepStrictEqual(
      outline(
        buildMultiSelectThreadContextMenuItems({
          variant: "inbox",
          count: 3,
          pinnedCount: 2,
          settleableCount: 1,
          hasRunningThread: false,
          titleRegeneration: null,
        }),
      ),
      [
        ["unpin", "Unpin (2)", false, false],
        ["settle", "Settle (3)", false, false],
        ["mark-unread", "Mark unread (3)", false, false],
        ["delete", "Delete (3)", false, true],
      ],
    );
  });

  it("offers Snooze with its presets and Custom… after Settle, only when every thread can be snoozed", () => {
    const menu = (
      snooze: Exclude<
        Parameters<typeof buildMultiSelectThreadContextMenuItems>[0]["snooze"],
        undefined
      >,
    ) =>
      buildMultiSelectThreadContextMenuItems({
        variant: "inbox",
        count: 2,
        pinnedCount: 0,
        settleableCount: 2,
        hasRunningThread: false,
        titleRegeneration: null,
        snooze,
      });
    const presets = [
      { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: at(15) },
      { id: "tomorrow", label: "Tomorrow", whenLabel: "9:00 AM", snoozedUntil: at(9) },
    ] as const;
    const items = menu({ presets });
    assert.deepStrictEqual(outline(items).slice(0, 2), [
      ["settle", "Settle (2)", false, false],
      ["snooze", "Snooze (2)", false, false],
    ]);
    assert.deepStrictEqual(
      items[1]!.children?.map((item) => [item.id, item.label, item.separatorBefore === true]),
      [
        ["snooze:hour", "In 1 hour (3:00 PM)", false],
        ["snooze:tomorrow", "Tomorrow (9:00 AM)", false],
        ["snooze:custom", "Custom…", true],
      ],
    );
    assert.notInclude(
      outline(menu(null)).map((item) => item[0]),
      "snooze",
    );
  });

  it("leaves out Unpin with no pinned thread, and disables Settle when every thread is settled", () => {
    assert.deepStrictEqual(
      outline(
        buildMultiSelectThreadContextMenuItems({
          variant: "inbox",
          count: 2,
          pinnedCount: 0,
          settleableCount: 0,
          hasRunningThread: false,
          titleRegeneration: null,
        }),
      ).slice(0, 1),
      [["settle", "Settle (2)", true, false]],
    );
  });

  it("offers to regenerate the titles not already being regenerated", () => {
    const regenerate = (supported: number, actionable: number) =>
      outline(
        buildMultiSelectThreadContextMenuItems({
          variant: "inbox",
          count: 2,
          pinnedCount: 0,
          settleableCount: 2,
          hasRunningThread: false,
          titleRegeneration: { supportedCount: supported, actionableCount: actionable },
        }),
      )[1];
    assert.deepStrictEqual(regenerate(2, 1), [
      "regenerate-title",
      "Regenerate titles (1)",
      false,
      false,
    ]);
    assert.deepStrictEqual(regenerate(2, 0), [
      "regenerate-title",
      "Regenerating… (2)",
      true,
      false,
    ]);
  });

  it("offers the project tree's items: mark unread, archive unless a thread is working, and delete", () => {
    assert.deepStrictEqual(
      outline(
        buildMultiSelectThreadContextMenuItems({
          variant: "tree",
          count: 2,
          pinnedCount: 0,
          settleableCount: 0,
          hasRunningThread: true,
          titleRegeneration: null,
        }),
      ),
      [
        ["mark-unread", "Mark unread (2)", false, false],
        ["archive", "Archive (2)", true, false],
        ["delete", "Delete (2)", false, true],
      ],
    );
  });
});

describe("project scope", () => {
  it("offers each project, most recently active first, as its own group", () => {
    const groups = buildSidebarProjectGroups({
      projects: [project("space-game"), project("rocket-game")],
      threads: [thread("a", { projectId: ProjectId.make("rocket-game"), createdAt: at(5) })],
      sortOrder: "updated_at",
    });
    assert.deepStrictEqual(
      groups.map((group) => [group.key, group.displayName, group.projectIds.map(String)]),
      [
        ["rocket-game", "rocket-game", ["rocket-game"]],
        ["space-game", "space-game", ["space-game"]],
      ],
    );
  });

  it("groups threads without a project as one No project group", () => {
    const groups = buildSidebarProjectGroups({
      projects: [project("space-game"), project("scratch-1"), project("scratch-2")],
      threads: [],
      sortOrder: "created_at",
      isScratchProject: (candidate) => candidate.id.startsWith("scratch"),
    });
    assert.deepStrictEqual(
      groups.map((group) => [group.displayName, group.projectIds.map(String)]),
      [
        ["No project", ["scratch-1", "scratch-2"]],
        ["space-game", ["space-game"]],
      ],
    );
  });

  it("shows every project when the scope names a project that is gone", () => {
    const groups = buildSidebarProjectGroups({
      projects: [project("space-game")],
      threads: [],
      sortOrder: "updated_at",
    });
    assert.strictEqual(resolveSidebarProjectScope(groups, "space-game")?.key, "space-game");
    assert.isNull(resolveSidebarProjectScope(groups, "rocket-game"));
    assert.isNull(resolveSidebarProjectScope(groups, null));
  });
});

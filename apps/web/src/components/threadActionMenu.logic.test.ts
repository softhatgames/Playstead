import { assert, describe, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";

import {
  archivedThreadMenuItems,
  buildThreadActionMenuItems,
  fallbackThreadAfterDelete,
  legacyThreadMenuItems,
  threadArchiveConfirmation,
  threadDeleteConfirmation,
  threadRuntimeCanArchive,
} from "./threadActionMenu.logic.ts";

const idle = { isRunning: false, projectFilter: null, isPinned: false, isSettled: false } as const;

/** Each item as `[id, label, disabled, destructive, separatorBefore, children]`. */
const outline = (items: ReturnType<typeof buildThreadActionMenuItems>) =>
  items.map((item) => [
    item.id,
    item.label,
    item.disabled === true,
    item.destructive === true,
    item.separatorBefore === true,
    (item.children ?? []).map((child) => [child.id, child.label]),
  ]);

describe("buildThreadActionMenuItems", () => {
  it("offers T3 Code's items in its order: pin, settle, rename, mark unread, copy, archive, then delete", () => {
    assert.deepStrictEqual(outline(buildThreadActionMenuItems(idle)), [
      ["pin", "Pin thread", false, false, false, []],
      ["settle", "Settle thread", false, false, false, []],
      ["rename", "Rename thread", false, false, true, []],
      ["mark-unread", "Mark unread", false, false, false, []],
      [
        "copy",
        "Copy",
        false,
        false,
        true,
        [
          ["copy-path", "Path"],
          ["copy-thread-id", "Thread ID"],
        ],
      ],
      ["archive", "Archive thread", false, false, true, []],
      ["delete", "Delete", false, true, false, []],
    ]);
  });

  it("offers to filter the sidebar by the thread's project after Mark unread, or to show all projects again", () => {
    const filterItem = (isActive: boolean) =>
      outline(
        buildThreadActionMenuItems({
          ...idle,
          projectFilter: { label: "space-game", isActive },
        }),
      ).slice(3, 5);
    assert.deepStrictEqual(filterItem(false), [
      ["mark-unread", "Mark unread", false, false, false, []],
      ["filter-by-project", "Filter by space-game", false, false, false, []],
    ]);
    assert.deepStrictEqual(filterItem(true)[1], [
      "filter-by-project",
      "Show all projects",
      false,
      false,
      false,
      [],
    ]);
  });

  it("offers Unpin thread for a pinned thread and Un-settle thread for a settled one", () => {
    assert.deepStrictEqual(
      outline(buildThreadActionMenuItems({ ...idle, isPinned: true, isSettled: true }))
        .slice(0, 2)
        .map(([id, label]) => [id, label]),
      [
        ["unpin", "Unpin thread"],
        ["unsettle", "Un-settle thread"],
      ],
    );
  });

  it("disables Archive thread while the thread's run is working, and keeps the rest", () => {
    const items = buildThreadActionMenuItems({ ...idle, isRunning: true });
    assert.deepStrictEqual(
      items.filter((item) => item.disabled === true).map((item) => item.id),
      ["archive"],
    );
  });
});

describe("legacyThreadMenuItems", () => {
  it("offers the project tree's flat menu: rename, mark unread, copy path, copy thread ID, then delete", () => {
    assert.deepStrictEqual(
      legacyThreadMenuItems.map((item) => [item.id, item.label, item.destructive === true]),
      [
        ["rename", "Rename thread", false],
        ["mark-unread", "Mark unread", false],
        ["copy-path", "Copy Path", false],
        ["copy-thread-id", "Copy Thread ID", false],
        ["delete", "Delete", true],
      ],
    );
  });
});

describe("threadRuntimeCanArchive", () => {
  it("is false while a run is starting or running, as T3 Code's", () => {
    assert.deepStrictEqual(
      (["idle", "starting", "running", "waiting", "completed", "failed"] as const).map((status) => [
        status,
        threadRuntimeCanArchive(status),
      ]),
      [
        ["idle", true],
        ["starting", false],
        ["running", false],
        ["waiting", true],
        ["completed", true],
        ["failed", true],
      ],
    );
  });
});

describe("archivedThreadMenuItems", () => {
  it("offers Unarchive, then Delete as the destructive item", () => {
    assert.deepStrictEqual(
      archivedThreadMenuItems.map((item) => [item.id, item.label, item.destructive === true]),
      [
        ["unarchive", "Unarchive", false],
        ["delete", "Delete", true],
      ],
    );
  });
});

describe("confirmations", () => {
  it("asks before archiving and, destructively, before deleting, with T3 Code's words", () => {
    assert.strictEqual(threadArchiveConfirmation("Make a maze"), 'Archive thread "Make a maze"?');
    assert.strictEqual(
      threadDeleteConfirmation("Make a maze"),
      'Delete thread "Make a maze"?\nThis permanently clears conversation history for this thread.',
    );
  });
});

describe("fallbackThreadAfterDelete", () => {
  const thread = (id: string, projectId: string, createdAt: string) => ({
    id: ThreadId.make(id),
    projectId: ProjectId.make(projectId),
    createdAt,
  });
  const threads = [
    thread("old", "a", "2026-10-17T01:00:00.000Z"),
    thread("deleted", "a", "2026-10-17T03:00:00.000Z"),
    thread("newer", "a", "2026-10-17T02:00:00.000Z"),
    thread("elsewhere", "b", "2026-10-17T04:00:00.000Z"),
  ];

  it("moves to the newest other thread of the same project", () => {
    assert.strictEqual(
      fallbackThreadAfterDelete(threads, ThreadId.make("deleted")),
      ThreadId.make("newer"),
    );
  });

  it("has nowhere to go when the project has no other thread", () => {
    assert.isNull(fallbackThreadAfterDelete(threads, ThreadId.make("elsewhere")));
    assert.isNull(fallbackThreadAfterDelete(threads, ThreadId.make("unknown")));
  });
});

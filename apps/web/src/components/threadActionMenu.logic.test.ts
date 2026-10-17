import { assert, describe, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";

import {
  archivedThreadMenuItems,
  buildThreadActionMenuItems,
  fallbackThreadAfterDelete,
  threadArchiveConfirmation,
  threadDeleteConfirmation,
  threadRuntimeCanArchive,
} from "./threadActionMenu.logic.ts";

describe("buildThreadActionMenuItems", () => {
  it("disables only regeneration while a title is being generated", () => {
    const items = buildThreadActionMenuItems({ isRunning: false, isTitleRegenerating: true });
    assert.deepStrictEqual(
      items.find((item) => item.id === "regenerate-title"),
      { id: "regenerate-title", label: "Regenerating…", disabled: true },
    );
    assert.notStrictEqual(items.find((item) => item.id === "rename")?.disabled, true);
  });
  it("offers rename and mark unread before Archive thread and Delete", () => {
    const items = buildThreadActionMenuItems({ isRunning: false });
    assert.deepStrictEqual(
      items.map((item) => [item.id, item.label, item.disabled === true, item.destructive === true]),
      [
        ["rename", "Rename thread", false, false],
        ["regenerate-title", "Regenerate title", false, false],
        ["mark-unread", "Mark unread", false, false],
        ["archive", "Archive thread", false, false],
        ["delete", "Delete", false, true],
      ],
    );
  });

  it("disables Archive thread while the thread's run is working, and keeps Delete", () => {
    const items = buildThreadActionMenuItems({ isRunning: true });
    assert.deepStrictEqual(
      items.map((item) => [item.id, item.disabled === true]),
      [
        ["rename", false],
        ["regenerate-title", false],
        ["mark-unread", false],
        ["archive", true],
        ["delete", false],
      ],
    );
  });
});

describe("threadRuntimeCanArchive", () => {
  it("is false while any run is active", () => {
    assert.deepStrictEqual(
      (["idle", "starting", "running", "waiting", "completed", "failed"] as const).map((status) => [
        status,
        threadRuntimeCanArchive(status),
      ]),
      [
        ["idle", true],
        ["starting", false],
        ["running", false],
        ["waiting", false],
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

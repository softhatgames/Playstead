import { assert, describe, it } from "@effect/vitest";
import { ProjectId, RunId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

import { applyShellStreamItem } from "./shell.ts";

const project = (id: string, title = id) => ({
  id: ProjectId.make(id),
  title,
  workspaceRoot: `/games/${id}`,
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:00.000Z",
});

const thread = (
  id: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({
  id: ThreadId.make(id),
  projectId: ProjectId.make("a"),
  title: "New thread",
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
  ...overrides,
});

describe("applyShellStreamItem", () => {
  const snapshot = {
    snapshotSequence: 3,
    projects: [project("a")],
    threads: [],
    archivedThreads: [],
  };

  it("takes the snapshot, then adds and replaces projects as they change", () => {
    const fromSnapshot = applyShellStreamItem(undefined, { kind: "snapshot", snapshot });
    const added = applyShellStreamItem(fromSnapshot, {
      kind: "project.updated",
      sequence: 4,
      project: project("b"),
    });
    const renamed = applyShellStreamItem(added, {
      kind: "project.updated",
      sequence: 5,
      project: project("a", "renamed"),
    });

    assert.deepStrictEqual(renamed, {
      snapshotSequence: 5,
      projects: [project("a", "renamed"), project("b")],
      threads: [],
      archivedThreads: [],
    });
  });

  it("takes out a project that was removed", () => {
    const shell = applyShellStreamItem(
      { ...snapshot, projects: [project("a"), project("b")] },
      { kind: "project.removed", sequence: 4, projectId: ProjectId.make("a") },
    );

    assert.deepStrictEqual(shell?.projects, [project("b")]);
    assert.strictEqual(shell?.snapshotSequence, 4);
  });

  it("adds a thread, then follows its title and run", () => {
    const shell = applyShellStreamItem(undefined, { kind: "snapshot", snapshot });
    const created = applyShellStreamItem(shell, {
      kind: "thread.updated",
      sequence: 4,
      thread: thread("t"),
    });
    const working = applyShellStreamItem(created, {
      kind: "thread.updated",
      sequence: 6,
      thread: thread("t", {
        title: "Make a game",
        latestRunId: RunId.make("run:1"),
        activeRunId: RunId.make("run:1"),
        status: "running",
      }),
    });

    assert.deepStrictEqual(working?.threads, [
      thread("t", {
        title: "Make a game",
        latestRunId: RunId.make("run:1"),
        activeRunId: RunId.make("run:1"),
        status: "running",
      }),
    ]);
    assert.strictEqual(working?.snapshotSequence, 6);
  });

  it("takes out a thread that was archived or deleted, and ignores one it never had", () => {
    const shell = applyShellStreamItem(
      { ...snapshot, threads: [thread("kept"), thread("archived"), thread("deleted")] },
      { kind: "thread.removed", sequence: 4, threadId: ThreadId.make("archived") },
    );
    const deleted = applyShellStreamItem(shell, {
      kind: "thread.removed",
      sequence: 5,
      threadId: ThreadId.make("deleted"),
    });
    const unknown = applyShellStreamItem(deleted, {
      kind: "thread.removed",
      sequence: 6,
      threadId: ThreadId.make("never-seen"),
    });

    assert.deepStrictEqual(unknown?.threads, [thread("kept")]);
    assert.strictEqual(unknown?.snapshotSequence, 6);
  });

  it("drops a change the shell already holds", () => {
    const shell = applyShellStreamItem(undefined, { kind: "snapshot", snapshot });

    const replayed = applyShellStreamItem(shell, {
      kind: "project.updated",
      sequence: 3,
      project: project("a", "stale"),
    });
    const replayedThread = applyShellStreamItem(replayed, {
      kind: "thread.updated",
      sequence: 2,
      thread: thread("old"),
    });

    assert.deepStrictEqual(replayedThread, snapshot);
  });
});

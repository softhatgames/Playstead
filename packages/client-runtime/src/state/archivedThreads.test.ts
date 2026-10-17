import { assert, describe, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2ArchivedShellSnapshot,
  OrchestrationV2ThreadShell,
} from "@playstead/contracts/orchestrationV2";

import { applyArchivedShellStreamItem, groupArchivedThreadsByProject } from "./archivedThreads.ts";

const project = (id: string, title = id) => ({
  id: ProjectId.make(id),
  title,
  workspaceRoot: `/games/${id}`,
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:00.000Z",
});

const thread = (
  id: string,
  projectId: string,
  archivedAt: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({
  id: ThreadId.make(id),
  projectId: ProjectId.make(projectId),
  title: `Thread ${id}`,
  providerInstanceId: "claudeAgent",
  modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
  latestRunId: null,
  activeRunId: null,
  status: "idle",
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: archivedAt,
  archivedAt,
  deletedAt: null,
  latestRunCompletedAt: null,
  lastVisitedAt: null,
  settledOverride: null,
  settledAt: null,
  unsettledAt: null,
  pinnedAt: null,
  pinOrderKey: null,
  activeOrderKey: null,
  ...overrides,
});

const snapshot = (
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
): OrchestrationV2ArchivedShellSnapshot => ({
  snapshotSequence: 10,
  projects: [project("a", "Asteroids"), project("b", "Breakout"), project("c", "Chess")],
  threads,
});

describe("applyArchivedShellStreamItem", () => {
  it("takes the snapshot, adds a thread archived after it, and removes one unarchived", () => {
    const first = applyArchivedShellStreamItem(undefined, {
      kind: "snapshot",
      snapshot: snapshot([thread("1", "a", "2026-10-17T01:00:00.000Z")]),
    });
    const archived = applyArchivedShellStreamItem(first, {
      kind: "thread.updated",
      sequence: 11,
      thread: thread("2", "a", "2026-10-17T02:00:00.000Z"),
    });
    const unarchived = applyArchivedShellStreamItem(archived, {
      kind: "thread.removed",
      sequence: 12,
      threadId: ThreadId.make("1"),
    });

    assert.deepStrictEqual(
      unarchived?.threads.map((shell) => shell.id),
      ["2"],
    );
    assert.strictEqual(unarchived?.snapshotSequence, 12);
  });

  it("drops a change the archive already holds", () => {
    const held = snapshot([thread("1", "a", "2026-10-17T01:00:00.000Z")]);
    const replayed = applyArchivedShellStreamItem(held, {
      kind: "thread.removed",
      sequence: 9,
      threadId: ThreadId.make("1"),
    });
    assert.deepStrictEqual(replayed, held);
  });
});

describe("groupArchivedThreadsByProject", () => {
  it("groups threads under their projects in the projects' order, newest archived first", () => {
    const groups = groupArchivedThreadsByProject(
      snapshot([
        thread("old", "b", "2026-10-17T01:00:00.000Z"),
        thread("x", "a", "2026-10-17T03:00:00.000Z"),
        thread("new", "b", "2026-10-17T05:00:00.000Z"),
        thread("y", "a", "2026-10-17T03:00:00.000Z"),
      ]),
    );

    assert.deepStrictEqual(
      groups.map((group) => [group.project.title, group.threads.map((shell) => shell.id)]),
      [
        // Archived at the same moment: the later id first, as T3 Code breaks the tie.
        ["Asteroids", ["y", "x"]],
        ["Breakout", ["new", "old"]],
      ],
    );
  });

  it("leaves out a thread whose project the archive does not have", () => {
    const groups = groupArchivedThreadsByProject(
      snapshot([thread("lost", "gone", "2026-10-17T01:00:00.000Z")]),
    );
    assert.deepStrictEqual(groups, []);
  });
});

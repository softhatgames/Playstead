import { assert, describe, it } from "@effect/vitest";
import { ProjectId } from "@playstead/contracts/baseSchemas";

import { applyShellStreamItem } from "./shell.ts";

const project = (id: string, title = id) => ({
  id: ProjectId.make(id),
  title,
  workspaceRoot: `/games/${id}`,
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:00.000Z",
});

describe("applyShellStreamItem", () => {
  const snapshot = { snapshotSequence: 3, projects: [project("a")] };

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
    });
  });

  it("drops a change the shell already holds", () => {
    const shell = applyShellStreamItem(undefined, { kind: "snapshot", snapshot });

    const replayed = applyShellStreamItem(shell, {
      kind: "project.updated",
      sequence: 3,
      project: project("a", "stale"),
    });

    assert.deepStrictEqual(replayed, snapshot);
  });
});

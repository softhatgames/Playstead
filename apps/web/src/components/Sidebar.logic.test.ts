import { assert, describe, it } from "@effect/vitest";

import {
  hasUnseenCompletion,
  isTrailingDoubleClick,
  reorderProjects,
  sortTreeProjects,
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

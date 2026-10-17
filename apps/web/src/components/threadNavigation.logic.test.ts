import { describe, expect, it } from "@effect/vitest";

import {
  createThreadJumpHintVisibilityController,
  resolveAdjacentThreadId,
  resolveNewThreadProjectId,
  shouldCreateNewThreadInCurrentProject,
  visibleTreeThreads,
} from "./threadNavigation.logic.ts";

/**
 * Moving between threads and starting new ones from the keyboard (T3 Code's
 * `resolveAdjacentThreadId`, `shouldCreateNewThreadInCurrentProject`,
 * `createThreadJumpHintVisibilityController` in `Sidebar.logic.ts`, the
 * tree's visible threads in `LegacySidebar.tsx` and
 * `resolveThreadActionProjectRef` in `lib/chatThreadActions.ts` at 2577baf).
 */

describe("previous and next thread", () => {
  const ids = ["a", "b", "c"];

  it("moves one row up or down the sidebar, stopping at either end", () => {
    expect(
      resolveAdjacentThreadId({ threadIds: ids, currentThreadId: "b", direction: "previous" }),
    ).toBe("a");
    expect(
      resolveAdjacentThreadId({ threadIds: ids, currentThreadId: "b", direction: "next" }),
    ).toBe("c");
    expect(
      resolveAdjacentThreadId({ threadIds: ids, currentThreadId: "a", direction: "previous" }),
    ).toBeNull();
    expect(
      resolveAdjacentThreadId({ threadIds: ids, currentThreadId: "c", direction: "next" }),
    ).toBeNull();
  });

  it("from no thread goes to the first for next and the last for previous", () => {
    expect(
      resolveAdjacentThreadId({ threadIds: ids, currentThreadId: null, direction: "next" }),
    ).toBe("a");
    expect(
      resolveAdjacentThreadId({ threadIds: ids, currentThreadId: null, direction: "previous" }),
    ).toBe("c");
    expect(
      resolveAdjacentThreadId({ threadIds: [], currentThreadId: null, direction: "next" }),
    ).toBeNull();
  });

  it("does nothing from a thread the sidebar does not show", () => {
    expect(
      resolveAdjacentThreadId({ threadIds: ids, currentThreadId: "z", direction: "next" }),
    ).toBeNull();
  });
});

describe("New thread", () => {
  it("opens New thread in… when there are several project groups, unless Shift is held", () => {
    expect(shouldCreateNewThreadInCurrentProject(false, 2)).toBe(false);
    expect(shouldCreateNewThreadInCurrentProject(true, 2)).toBe(true);
    expect(shouldCreateNewThreadInCurrentProject(false, 1)).toBe(true);
    expect(shouldCreateNewThreadInCurrentProject(false, 0)).toBe(true);
  });

  it("starts in the thread in view's project, else the draft's, else the last opened, else the first", () => {
    const projectIds = ["first", "second", "third"];
    expect(
      resolveNewThreadProjectId({
        threadProjectId: "second",
        draftProjectId: "third",
        openedProjectId: "third",
        projectIds,
      }),
    ).toBe("second");
    expect(
      resolveNewThreadProjectId({ draftProjectId: "third", openedProjectId: "second", projectIds }),
    ).toBe("third");
    expect(resolveNewThreadProjectId({ openedProjectId: "second", projectIds })).toBe("second");
    expect(resolveNewThreadProjectId({ projectIds })).toBe("first");
    expect(resolveNewThreadProjectId({ projectIds: [] })).toBeUndefined();
  });

  it("passes over a project that is gone or outside the sidebar's scope", () => {
    expect(
      resolveNewThreadProjectId({
        threadProjectId: "gone",
        openedProjectId: "second",
        projectIds: ["first", "second"],
      }),
    ).toBe("second");
    expect(
      resolveNewThreadProjectId({
        threadProjectId: "first",
        projectIds: ["first", "second"],
        scopedProjectIds: new Set(["second"]),
      }),
    ).toBe("second");
  });
});

describe("the tree's thread order for the keyboard", () => {
  const thread = (id: string, projectId: string) => ({ id, projectId });
  const projects = [{ id: "space" }, { id: "rocket" }];
  const threadsByProject = new Map([
    ["space", [thread("s1", "space"), thread("s2", "space"), thread("s3", "space")]],
    ["rocket", [thread("r1", "rocket")]],
  ]);

  it("follows the projects, each with the threads it shows until Show more", () => {
    expect(
      visibleTreeThreads({
        projects,
        threadsByProject,
        previewCount: 2,
        expandedProjectIds: new Set(),
        activeThreadId: undefined,
      }).map((entry) => entry.id),
    ).toEqual(["s1", "s2", "r1"]);
    expect(
      visibleTreeThreads({
        projects,
        threadsByProject,
        previewCount: 2,
        expandedProjectIds: new Set(["space"]),
        activeThreadId: undefined,
      }).map((entry) => entry.id),
    ).toEqual(["s1", "s2", "s3", "r1"]);
  });

  it("keeps the thread in view shown when its project's list is folded", () => {
    expect(
      visibleTreeThreads({
        projects,
        threadsByProject,
        previewCount: 1,
        expandedProjectIds: new Set(),
        activeThreadId: "s3",
      }).map((entry) => entry.id),
    ).toEqual(["s1", "s3", "r1"]);
  });
});

describe("jump hints", () => {
  const harness = () => {
    const timers = new Map<number, () => void>();
    let nextId = 1;
    const changes: boolean[] = [];
    const controller = createThreadJumpHintVisibilityController({
      delayMs: 200,
      onVisibilityChange: (visible) => changes.push(visible),
      setTimeoutFn: (callback) => {
        const id = nextId++;
        timers.set(id, callback);
        return id;
      },
      clearTimeoutFn: (id) => timers.delete(id),
    });
    const elapse = () => {
      for (const [id, callback] of timers) {
        timers.delete(id);
        callback();
      }
    };
    return { controller, changes, elapse, pending: () => timers.size };
  };

  it("show once the modifier has been held for the delay, and hide as soon as it is let go", () => {
    const { controller, changes, elapse } = harness();
    controller.sync(true);
    expect(changes).toEqual([]);
    elapse();
    expect(changes).toEqual([true]);
    controller.sync(true);
    controller.sync(false);
    expect(changes).toEqual([true, false]);
  });

  it("never show for a modifier let go before the delay", () => {
    const { controller, changes, elapse, pending } = harness();
    controller.sync(true);
    controller.sync(false);
    expect(pending()).toBe(0);
    elapse();
    expect(changes).toEqual([]);
  });
});

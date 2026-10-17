import { expect, it } from "@effect/vitest";
import { threadNavigationTarget, newThreadDestination } from "./threadNavigation.ts";

it("traverses the sidebar order without wrapping, enters at either end from a draft, and refuses missing current threads", () => {
  const order = ["pinned", "active", "settled"];
  expect(threadNavigationTarget(order, "active", "thread.previous")).toBe("pinned");
  expect(threadNavigationTarget(order, "active", "thread.next")).toBe("settled");
  expect(threadNavigationTarget(order, "pinned", "thread.previous")).toBeNull();
  expect(threadNavigationTarget(order, "settled", "thread.next")).toBeNull();
  expect(threadNavigationTarget(order, undefined, "thread.previous")).toBe("settled");
  expect(threadNavigationTarget(order, undefined, "thread.next")).toBe("pinned");
  expect(threadNavigationTarget(order, "hidden", "thread.next")).toBeNull();
  expect(threadNavigationTarget(order, "active", "thread.jump.3")).toBe("settled");
  expect(threadNavigationTarget(order, "active", "thread.jump.9")).toBeNull();
  expect(threadNavigationTarget([], undefined, "thread.next")).toBeNull();
});

it("mod+n asks for a project in the inbox with several projects, while local and legacy creation use the current project", () => {
  const input = {
    projectIds: ["a", "b"],
    preferredProjectIds: ["gone", "b"],
    legacySidebarEnabled: false,
    local: false,
  };
  expect(newThreadDestination(input)).toEqual({ kind: "picker" });
  expect(newThreadDestination({ ...input, local: true })).toEqual({
    kind: "project",
    projectId: "b",
  });
  expect(newThreadDestination({ ...input, legacySidebarEnabled: true })).toEqual({
    kind: "project",
    projectId: "b",
  });
  expect(newThreadDestination({ ...input, projectIds: ["a"] })).toEqual({
    kind: "project",
    projectId: "a",
  });
  expect(newThreadDestination({ ...input, projectIds: [] })).toEqual({ kind: "add-project" });
});

it("starts scratch without projects and counts it once in the chooser", () => {
  const input = {
    projectIds: [],
    preferredProjectIds: [],
    local: false,
    legacySidebarEnabled: false,
    scratchAvailable: true,
  };
  expect(newThreadDestination(input)).toEqual({ kind: "scratch" });
  expect(newThreadDestination({ ...input, projectIds: ["game"] })).toEqual({ kind: "picker" });
  expect(
    newThreadDestination({ ...input, projectIds: ["scratch"], scratchProjectId: "scratch" }),
  ).toEqual({ kind: "project", projectId: "scratch" });
});

import { expect, it } from "@effect/vitest";
import { sortSidebarProjects } from "./LegacySidebar.sort.ts";

it("sorts project activity or creation, retaining manual order with new projects appended", () => {
  const projects = [
    { id: "a", title: "A", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    { id: "b", title: "B", createdAt: "2026-02-01", updatedAt: "2026-02-01" },
    { id: "c", title: "C", createdAt: "2026-03-01", updatedAt: "2026-03-01" },
  ];
  const threads = [
    {
      projectId: "a",
      createdAt: "2026-04-01",
      updatedAt: "2026-05-01",
      latestRunRequestedAt: "2026-05-01",
      archivedAt: null,
      deletedAt: null,
    },
  ];
  expect(sortSidebarProjects(projects, threads, "updated_at", []).map((p) => p.id)).toEqual([
    "a",
    "c",
    "b",
  ]);
  expect(sortSidebarProjects(projects, threads, "created_at", []).map((p) => p.id)).toEqual([
    "a",
    "c",
    "b",
  ]);
  expect(sortSidebarProjects(projects, [], "created_at", []).map((p) => p.id)).toEqual([
    "c",
    "b",
    "a",
  ]);
  expect(
    sortSidebarProjects(projects, threads, "manual", ["b", "gone", "a"]).map((p) => p.id),
  ).toEqual(["b", "a", "c"]);
});

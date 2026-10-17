import type { ProjectId } from "@playstead/contracts/baseSchemas";
import type { ClientSettings } from "@playstead/contracts/ipc";
import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

/**
 * How the sidebar groups projects for its scope menu (T3 Code's
 * `apps/web/src/sidebarProjectGrouping.ts` and `hooks/useSidebarProjectGroups.ts`
 * at 2577baf).
 */

export type SidebarProjectSortOrder = ClientSettings["sidebarProjectSortOrder"];

/** A choice in the project scope menu: one project, or every thread without one. */
export interface SidebarProjectGroup {
  readonly key: string;
  readonly displayName: string;
  readonly projectIds: ReadonlyArray<ProjectId>;
  readonly isScratch: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const SCRATCH_GROUP_KEY = "scratch";

const timeOf = (iso: string | null): number => {
  if (iso === null) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * The projects the scope menu offers (T3 Code's `useSidebarProjectGroups`,
 * `buildSidebarProjectSnapshots` with `groupScratchProjects`, and
 * `sortSidebarV2ProjectGroups`). Each project is its own group: T3 Code
 * merges the projects of one repository (`sidebarProjectGroupingMode`),
 * which Playstead cannot see until version control (slice 4). The
 * "No project" projects (#43) make one group. Groups are ordered by their
 * latest thread activity (`updated_at`), by creation (`created_at`), or as
 * the server lists them (`manual`), ties by name.
 */
export function buildSidebarProjectGroups(input: {
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly sortOrder: SidebarProjectSortOrder;
  readonly isScratchProject?: (project: OrchestrationProjectShell) => boolean;
}): ReadonlyArray<SidebarProjectGroup> {
  const isScratch = input.isScratchProject ?? (() => false);
  const scratch = input.projects.filter(isScratch);
  const groups: SidebarProjectGroup[] = input.projects
    .filter((project) => !isScratch(project))
    .map((project) => ({
      key: project.id,
      displayName: project.title,
      projectIds: [project.id],
      isScratch: false,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }));
  if (scratch.length > 0) {
    groups.push({
      key: SCRATCH_GROUP_KEY,
      displayName: "No project",
      projectIds: scratch.map((project) => project.id),
      isScratch: true,
      createdAt: scratch.map((project) => project.createdAt).toSorted()[0]!,
      updatedAt: scratch
        .map((project) => project.updatedAt)
        .toSorted()
        .at(-1)!,
    });
  }
  if (input.sortOrder === "manual") return groups;

  const threadTime = (thread: OrchestrationV2ThreadShell) =>
    input.sortOrder === "created_at"
      ? timeOf(thread.createdAt)
      : timeOf(thread.latestRunRequestedAt) || timeOf(thread.updatedAt) || timeOf(thread.createdAt);
  const groupTime = (group: SidebarProjectGroup) => {
    const members = new Set<string>(group.projectIds);
    const times = input.threads
      .filter((thread) => thread.archivedAt === null && members.has(thread.projectId))
      .map(threadTime);
    if (times.length > 0) return Math.max(...times);
    return input.sortOrder === "created_at" ? timeOf(group.createdAt) : timeOf(group.updatedAt);
  };
  const times = new Map(groups.map((group) => [group.key, groupTime(group)]));
  return groups.toSorted(
    (left, right) =>
      times.get(right.key)! - times.get(left.key)! ||
      left.displayName.localeCompare(right.displayName) ||
      left.key.localeCompare(right.key),
  );
}

/**
 * The group the sidebar is scoped to, or null for every project; a scope to
 * a project that is gone shows every project (T3 Code's
 * `resolveSidebarProjectScopeKey`).
 */
export function resolveSidebarProjectScope(
  groups: ReadonlyArray<SidebarProjectGroup>,
  key: string | null,
): SidebarProjectGroup | null {
  if (key === null) return null;
  return groups.find((group) => group.key === key) ?? null;
}

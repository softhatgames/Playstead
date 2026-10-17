import type { ClientSettings } from "@playstead/contracts/ipc";

type Project = {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};
type Thread = {
  readonly projectId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly latestRunRequestedAt: string | null;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
};

/** T3 Code's legacy project ordering (LegacySidebar.tsx at 2577baf):
 * the newest visible thread supplies the project's time; empty projects use their own. */
export function sortSidebarProjects<T extends Project>(
  projects: ReadonlyArray<T>,
  threads: ReadonlyArray<Thread>,
  mode: ClientSettings["sidebarProjectSortOrder"],
  manual: ReadonlyArray<string>,
): T[] {
  const rank = new Map(manual.map((id, i) => [id, i]));
  if (mode === "manual")
    return projects.toSorted((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  const time = (project: T) => {
    const members = threads.filter(
      (t) => t.projectId === project.id && t.archivedAt === null && t.deletedAt === null,
    );
    const values = members.map((t) =>
      Date.parse(mode === "created_at" ? t.createdAt : (t.latestRunRequestedAt ?? t.updatedAt)),
    );
    return values.length
      ? Math.max(...values)
      : Date.parse(mode === "created_at" ? project.createdAt : project.updatedAt);
  };
  const times = new Map(projects.map((p) => [p.id, time(p)]));
  return projects.toSorted(
    (a, b) =>
      times.get(b.id)! - times.get(a.id)! ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}

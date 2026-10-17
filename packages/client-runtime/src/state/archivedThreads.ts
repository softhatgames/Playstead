import type {
  OrchestrationV2ArchivedShellSnapshot,
  OrchestrationV2ArchivedShellStreamItem,
  OrchestrationV2ThreadShell,
} from "@playstead/contracts/orchestrationV2";
import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";

const upsertById = <T extends { readonly id: string }>(list: ReadonlyArray<T>, next: T) =>
  list.some((item) => item.id === next.id)
    ? list.map((item) => (item.id === next.id ? next : item))
    : [...list, next];

/**
 * Folds the archived shell stream into **Settings → Archive**'s threads,
 * as the sidebar's shell is folded: a snapshot replaces it, a newer change
 * adds, replaces or removes a thread, and an old one is dropped.
 */
export const applyArchivedShellStreamItem = (
  archive: OrchestrationV2ArchivedShellSnapshot | undefined,
  item: OrchestrationV2ArchivedShellStreamItem,
): OrchestrationV2ArchivedShellSnapshot | undefined => {
  if (item.kind === "snapshot") return item.snapshot;
  if (archive === undefined || item.sequence <= archive.snapshotSequence) return archive;
  switch (item.kind) {
    case "thread.updated":
      return {
        ...archive,
        snapshotSequence: item.sequence,
        threads: upsertById(archive.threads, item.thread),
      };
    case "thread.removed":
      return {
        ...archive,
        snapshotSequence: item.sequence,
        threads: archive.threads.filter((thread) => thread.id !== item.threadId),
      };
  }
};

export interface ArchivedProjectGroup {
  readonly project: OrchestrationProjectShell;
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
}

/**
 * **Settings → Archive**'s sections (T3 Code's `ArchivedThreadsPanel` in
 * `apps/web/src/components/settings/SettingsPanels.tsx` at 2577baf): one per
 * project with archived threads, in the projects' order, each newest archived
 * first.
 */
export const groupArchivedThreadsByProject = (
  archive: OrchestrationV2ArchivedShellSnapshot,
): ReadonlyArray<ArchivedProjectGroup> =>
  archive.projects.flatMap((project) => {
    const threads = archive.threads
      .filter((thread) => thread.projectId === project.id)
      .toSorted((left, right) => {
        const leftKey = left.archivedAt ?? left.createdAt;
        const rightKey = right.archivedAt ?? right.createdAt;
        return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
      });
    return threads.length === 0 ? [] : [{ project, threads }];
  });

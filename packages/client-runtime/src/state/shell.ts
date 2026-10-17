import type {
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ShellStreamItem,
} from "@playstead/contracts/orchestrationV2";

const upsertById = <T extends { readonly id: string }>(list: ReadonlyArray<T>, next: T) =>
  list.some((item) => item.id === next.id)
    ? list.map((item) => (item.id === next.id ? next : item))
    : [...list, next];

/**
 * Folds the shell stream into the sidebar's shell, after T3 Code's shell
 * store (`packages/client-runtime/src/state/` at 2577baf): a snapshot
 * replaces it, and a change newer than what it holds replaces or adds its
 * project or thread, or takes out a thread that was archived or deleted or a
 * project that was removed. A change at or below the held sequence is old
 * and dropped.
 */
export const applyShellStreamItem = (
  shell: OrchestrationV2ShellSnapshot | undefined,
  item: OrchestrationV2ShellStreamItem,
): OrchestrationV2ShellSnapshot | undefined => {
  if (item.kind === "snapshot") return item.snapshot;
  if (shell === undefined || item.sequence <= shell.snapshotSequence) return shell;
  switch (item.kind) {
    case "project.updated":
      return {
        ...shell,
        snapshotSequence: item.sequence,
        projects: upsertById(shell.projects, item.project),
      };
    case "project.removed":
      return {
        ...shell,
        snapshotSequence: item.sequence,
        projects: shell.projects.filter((project) => project.id !== item.projectId),
      };
    case "thread.updated":
      return {
        ...shell,
        snapshotSequence: item.sequence,
        threads: upsertById(shell.threads, item.thread),
      };
    case "thread.removed":
      return {
        ...shell,
        snapshotSequence: item.sequence,
        threads: shell.threads.filter((thread) => thread.id !== item.threadId),
      };
  }
};

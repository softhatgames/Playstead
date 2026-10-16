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
 * project or thread. A change at or below the held sequence is old and dropped.
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
    case "thread.updated":
      return {
        ...shell,
        snapshotSequence: item.sequence,
        threads: upsertById(shell.threads, item.thread),
      };
  }
};

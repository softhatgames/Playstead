import type {
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ShellStreamItem,
} from "@playstead/contracts/orchestrationV2";

/**
 * Folds the shell stream into the sidebar's shell, after T3 Code's shell
 * store (`packages/client-runtime/src/state/` at 2577baf): a snapshot
 * replaces it, and a change newer than what it holds replaces or adds its
 * project. A change at or below the held sequence is old and dropped.
 */
export const applyShellStreamItem = (
  shell: OrchestrationV2ShellSnapshot | undefined,
  item: OrchestrationV2ShellStreamItem,
): OrchestrationV2ShellSnapshot | undefined => {
  switch (item.kind) {
    case "snapshot":
      return item.snapshot;
    case "project.updated": {
      if (shell === undefined || item.sequence <= shell.snapshotSequence) return shell;
      const known = shell.projects.some((project) => project.id === item.project.id);
      return {
        snapshotSequence: item.sequence,
        projects: known
          ? shell.projects.map((project) =>
              project.id === item.project.id ? item.project : project,
            )
          : [...shell.projects, item.project],
      };
    }
  }
};

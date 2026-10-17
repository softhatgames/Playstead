import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import type { ContextMenuItem } from "@playstead/contracts/ipc";

/** Project actions from T3 Code's LegacySidebar at 2577baf. */
export const projectMenuItems: ReadonlyArray<ContextMenuItem> = [
  { id: "rename", label: "Rename" },
  { id: "copy-path", label: "Copy Path" },
  { id: "settings", label: "Project settings" },
  { id: "remove", label: "Remove" },
];

export function projectRemovalConfirmation(
  project: Pick<OrchestrationProjectShell, "title" | "workspaceRoot">,
  threadCount: number,
): string {
  return [
    threadCount > 0
      ? `Remove project "${project.title}" and delete its ${threadCount} thread${threadCount === 1 ? "" : "s"}?`
      : `Remove project "${project.title}"?`,
    `Path: ${project.workspaceRoot}`,
    threadCount > 0
      ? "This permanently clears conversation history for those threads and any archived threads."
      : "This permanently clears any archived conversation history.",
    "This removes only this project entry. Files on disk are not touched.",
    "This action cannot be undone.",
  ].join("\n");
}

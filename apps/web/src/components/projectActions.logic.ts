import type { ContextMenuItem } from "@playstead/contracts/ipc";

/**
 * Renaming and removing a project, as T3 Code's interface words them at
 * 2577baf: the project tree's project menu and its confirmation
 * (`apps/web/src/components/LegacySidebar.tsx`, `handleRemoveProject`), and
 * **Project settings → Danger**'s
 * (`apps/web/src/components/settings/ProjectSettingsPanel.tsx`). "Group
 * into..." waits for project grouping (slice 4).
 */
export type ProjectMenuId = "rename" | "copy-path" | "project-settings" | "delete";

export const projectMenuItems: ReadonlyArray<ContextMenuItem<ProjectMenuId>> = [
  { id: "rename", label: "Rename" },
  { id: "copy-path", label: "Copy Path" },
  { id: "project-settings", label: "Project settings" },
  { id: "delete", label: "Remove", destructive: true },
];

export interface ProjectRemovalTarget {
  readonly title: string;
  readonly workspaceRoot: string;
  /** The project's threads the sidebar shows, which removing it deletes. */
  readonly threadCount: number;
}

const removalQuestion = (target: ProjectRemovalTarget) =>
  target.threadCount > 0
    ? `Remove project "${target.title}" and delete its ${target.threadCount} thread${
        target.threadCount === 1 ? "" : "s"
      }?`
    : `Remove project "${target.title}"?`;

const historyLine = (target: ProjectRemovalTarget) =>
  target.threadCount > 0
    ? "This permanently clears conversation history for those threads and any archived threads."
    : "This permanently clears any archived conversation history.";

/** The project tree's confirmation before removing a project. */
export const projectRemovalConfirmation = (target: ProjectRemovalTarget) =>
  [
    removalQuestion(target),
    `Path: ${target.workspaceRoot}`,
    historyLine(target),
    "This removes only this project entry.",
    ...(target.threadCount > 0 ? ["This action cannot be undone."] : []),
  ].join("\n");

/** **Project settings → Danger**'s confirmation before removing the project. */
export const projectSettingsRemovalConfirmation = (target: ProjectRemovalTarget) =>
  [
    removalQuestion(target),
    `Path: ${target.workspaceRoot}`,
    historyLine(target),
    "This removes only the project entries, not the files on disk.",
    "This action cannot be undone.",
  ].join("\n");

export type ProjectRenameCommit =
  | { readonly kind: "rename"; readonly title: string }
  | { readonly kind: "unchanged" }
  | { readonly kind: "empty" };

/** What **Save** in **Rename project** does with what was typed (T3 Code's `submitProjectRename`). */
export function resolveProjectRenameCommit(
  currentTitle: string,
  typed: string,
): ProjectRenameCommit {
  const title = typed.trim();
  if (title.length === 0) return { kind: "empty" };
  if (title === currentTitle) return { kind: "unchanged" };
  return { kind: "rename", title };
}

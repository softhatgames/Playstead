import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import type { ContextMenuPosition } from "@playstead/contracts/ipc";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
import { copyTextToClipboard } from "../../clipboard.ts";
import { renameProject, useProjectActions } from "../../hooks/useProjectActions.ts";
import { readLocalApi } from "../../localApi.ts";
import { failureToast, warningToast } from "../../toast.ts";
import { projectMenuItems } from "../projectActions.logic.ts";

/** Native context menu on desktop, browser fallback, with an inline rename field. */
export function ProjectMenuButton({
  project,
  children,
}: {
  readonly project: OrchestrationProjectShell;
  readonly children: (
    onContextMenu: (position: ContextMenuPosition) => void,
    renameInput: ReactNode,
  ) => ReactNode;
}) {
  const [title, setTitle] = useState<string | null>(null);
  const committed = useRef(false);
  const navigate = useNavigate();
  const { removeProject } = useProjectActions();
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const next = title?.trim() ?? "";
    setTitle(null);
    if (!next) {
      warningToast("Project title cannot be empty");
      return;
    }
    if (next !== project.title)
      void renameProject(project.id, next).catch((error: unknown) =>
        failureToast("Failed to rename project", error),
      );
  };
  const openMenu = (position: ContextMenuPosition) => {
    void (async () => {
      const chosen = await readLocalApi().contextMenu.show(projectMenuItems, position);
      switch (chosen) {
        case "rename":
          committed.current = false;
          setTitle(project.title);
          break;
        case "remove":
          removeProject(project);
          break;
        case "copy-path":
          await copyTextToClipboard(project.workspaceRoot);
          break;
        case "settings":
          await navigate({
            to: "/settings/projects/$projectId",
            params: { projectId: project.id },
          });
          break;
      }
    })().catch((error: unknown) => failureToast("Project action failed", error));
  };
  return children(
    openMenu,
    title === null ? null : (
      <input
        autoFocus
        aria-label="Project title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            committed.current = true;
            setTitle(null);
          }
        }}
        className="min-w-0 flex-1 rounded border border-neutral-400 bg-transparent px-2 py-1.5 text-sm outline-none"
      />
    ),
  );
}

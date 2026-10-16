import { useEffect, useRef } from "react";

import { openCommandPalette } from "../commandPaletteBus.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { openProject, useActiveProjectId } from "../uiState.ts";
import { FolderIcon, FolderPlusIcon } from "./icons.tsx";

/**
 * The left sidebar: T3 Code's project tree (`apps/web/src/components/LegacySidebar.tsx`
 * at 2577baf, `SidebarProjectsContent` and `SidebarProjectItem`), with
 * projects only. Projects are listed oldest first, as the server keeps them;
 * there is no removing, reordering or search.
 */
export function Sidebar() {
  const state = usePrimaryConnectionState();
  const projects = state?.shell?.projects;
  const activeProjectId = useActiveProjectId();
  const activeRow = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [activeProjectId]);

  return (
    <nav aria-label="Projects" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
      <div className="mb-1 flex items-center justify-between pr-1 pl-2">
        <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Projects</span>
        <button
          type="button"
          aria-label="Add project"
          title="Add project"
          onClick={() => openCommandPalette({ open: "add-project" })}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <FolderPlusIcon className="size-3.5" />
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {(projects ?? []).map((project) => {
          const active = project.id === activeProjectId;
          return (
            <li key={project.id}>
              <button
                ref={active ? activeRow : undefined}
                type="button"
                title={project.workspaceRoot}
                aria-current={active ? "true" : undefined}
                onClick={() => openProject(project.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                  active
                    ? "bg-neutral-200 font-medium dark:bg-neutral-800"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
                }`}
              >
                <FolderIcon className="size-3.5 shrink-0 text-neutral-500 dark:text-neutral-400" />
                <span className="truncate">{project.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {projects !== undefined && projects.length === 0 ? (
        <div className="px-2 pt-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
          No projects yet
        </div>
      ) : null}
    </nav>
  );
}

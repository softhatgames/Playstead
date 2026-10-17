import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2ThreadShell,
} from "@playstead/contracts/orchestrationV2";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { openCommandPalette } from "../commandPaletteBus.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { createDraft } from "../drafts.ts";
import { useThreadActionMenu } from "../hooks/useThreadActionMenu.ts";
import { openProject, useActiveProjectId } from "../uiState.ts";
import { FolderIcon, FolderPlusIcon, SquarePenIcon } from "./icons.tsx";

/**
 * The left sidebar: T3 Code's project tree (`apps/web/src/components/LegacySidebar.tsx`
 * at 2577baf, `SidebarProjectsContent`, `SidebarProjectItem` and
 * `SidebarProjectThreadList`). Projects are listed oldest first, as the
 * server keeps them, each with its threads newest first. **New thread** opens
 * a draft; right-clicking a thread opens its menu. There is no removing,
 * reordering or search yet.
 */
export function Sidebar() {
  const state = usePrimaryConnectionState();
  const projects = state?.shell?.projects;
  const threads = state?.shell?.threads ?? [];
  const activeProjectId = useActiveProjectId();
  const { threadId: activeThreadId } = useParams({ strict: false });
  const navigate = useNavigate();
  const activeRow = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [activeProjectId]);

  const startThread = (projectId: (typeof threads)[number]["projectId"]) => {
    openProject(projectId);
    void navigate({ to: "/draft/$draftId", params: { draftId: createDraft(projectId) } });
  };

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
          const projectThreads = threads
            .filter((thread) => thread.projectId === project.id)
            .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
          return (
            <li key={project.id}>
              <div className="group flex items-center">
                <button
                  ref={active ? activeRow : undefined}
                  type="button"
                  title={project.workspaceRoot}
                  aria-current={active ? "true" : undefined}
                  onClick={() => openProject(project.id)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                    active
                      ? "bg-neutral-200 font-medium dark:bg-neutral-800"
                      : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  }`}
                >
                  <FolderIcon className="size-3.5 shrink-0 text-neutral-500 dark:text-neutral-400" />
                  <span className="truncate">{project.title}</span>
                </button>
                <button
                  type="button"
                  aria-label={`New thread in ${project.title}`}
                  title="New thread"
                  onClick={() => startThread(project.id)}
                  className="rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                >
                  <SquarePenIcon className="size-3.5" />
                </button>
              </div>
              {projectThreads.length === 0 ? null : (
                <ul
                  aria-label={`Threads in ${project.title}`}
                  className="mt-0.5 ml-5 flex flex-col gap-0.5"
                >
                  {projectThreads.map((thread) => (
                    <SidebarThreadRow
                      key={thread.id}
                      thread={thread}
                      current={thread.id === activeThreadId}
                    />
                  ))}
                </ul>
              )}
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

/** A thread in the tree; right-clicking it opens the thread menu (T3 Code's `SidebarThreadRow`). */
function SidebarThreadRow({
  thread,
  current,
}: {
  readonly thread: OrchestrationV2ThreadShell;
  readonly current: boolean;
}) {
  const { openMenu } = useThreadActionMenu(thread);
  return (
    <li>
      <Link
        to="/threads/$threadId"
        params={{ threadId: thread.id }}
        onClick={() => openProject(thread.projectId)}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu({ x: event.clientX, y: event.clientY });
        }}
        aria-current={current ? "page" : undefined}
        className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${
          current
            ? "bg-neutral-200 dark:bg-neutral-800"
            : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
        }`}
      >
        <span className="truncate">{thread.title}</span>
        {thread.status !== "idle" && ACTIVE_RUN_STATUSES.has(thread.status) ? (
          <span
            aria-label="Working"
            className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-sky-500"
          />
        ) : null}
      </Link>
    </li>
  );
}

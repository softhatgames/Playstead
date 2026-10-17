import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2ThreadShell,
} from "@playstead/contracts/orchestrationV2";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

import { openCommandPalette } from "../commandPaletteBus.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { createDraft } from "../drafts.ts";
import { useThreadActionMenu } from "../hooks/useThreadActionMenu.ts";
import { renameThread } from "../hooks/useThreadActions.ts";
import { failureToast, warningToast } from "../toast.ts";
import {
  openProject,
  useActiveProjectId,
  useSidebarThreadRename,
  setSidebarThreadRename,
} from "../uiState.ts";
import { resolveRenameCommit } from "./chat/ChatHeader.logic.ts";
import { FolderIcon, FolderPlusIcon, SquarePenIcon } from "./icons.tsx";
import { hasUnseenCompletion, isTrailingDoubleClick } from "./Sidebar.logic.ts";

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

/**
 * A thread in the tree (T3 Code's `SidebarThreadRow` in `LegacySidebar.tsx`):
 * right-clicking it opens the thread menu, and double-clicking it, or
 * **Rename thread**, renames it in place. Its status shows before the
 * title: working while its run is, or **Completed**, the unseen-completion
 * dot, until the thread is viewed.
 */
function SidebarThreadRow({
  thread,
  current,
}: {
  readonly thread: OrchestrationV2ThreadShell;
  readonly current: boolean;
}) {
  const renamingTitle = useSidebarThreadRename(thread.id);
  const renameCommittedRef = useRef(false);
  const startRename = useCallback(() => {
    renameCommittedRef.current = false;
    setSidebarThreadRename({ threadId: thread.id, title: thread.title });
  }, [thread.id, thread.title]);
  const { openMenu } = useThreadActionMenu(thread, {
    onStartRename: startRename,
  });

  const commitRename = (typed: string) => {
    setSidebarThreadRename(null);
    const resolution = resolveRenameCommit({ title: typed, originalTitle: thread.title });
    if (resolution.action === "reject-empty") {
      warningToast("Thread title cannot be empty");
      return;
    }
    if (resolution.action === "noop") return;
    renameThread(thread.id, resolution.title).catch((error: unknown) =>
      failureToast("Failed to rename thread", error),
    );
  };

  const working = thread.status !== "idle" && ACTIVE_RUN_STATUSES.has(thread.status);
  const status = working ? (
    <span
      role="img"
      aria-label="Working"
      className="size-1.5 shrink-0 animate-pulse rounded-full bg-sky-500"
    />
  ) : hasUnseenCompletion(thread) ? (
    <span
      role="img"
      aria-label="Completed"
      title="Completed"
      className="size-1.5 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-300/90"
    />
  ) : null;
  const rowClass = `flex items-center gap-2 rounded-md px-2 py-1 text-sm ${
    current
      ? "bg-neutral-200 dark:bg-neutral-800"
      : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
  }`;

  if (renamingTitle !== null) {
    return (
      <li>
        <div className={`${rowClass} ${thread.titleRegeneration ? "opacity-55" : ""}`}>
          {status}
          <input
            autoFocus
            aria-label="Thread title"
            value={renamingTitle}
            onChange={(event) =>
              setSidebarThreadRename({ threadId: thread.id, title: event.target.value })
            }
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                renameCommittedRef.current = true;
                commitRename(event.currentTarget.value);
              } else if (event.key === "Escape") {
                event.preventDefault();
                renameCommittedRef.current = true;
                setSidebarThreadRename(null);
              }
            }}
            onBlur={(event) => {
              if (renameCommittedRef.current) return;
              commitRename(event.currentTarget.value);
            }}
            className="min-w-0 flex-1 truncate rounded border border-neutral-400 bg-transparent px-0.5 text-sm outline-none dark:border-neutral-500"
          />
        </div>
      </li>
    );
  }
  return (
    <li>
      <Link
        to="/threads/$threadId"
        params={{ threadId: thread.id }}
        onClick={(event) => {
          if (isTrailingDoubleClick(event.detail)) {
            event.preventDefault();
            return;
          }
          openProject(thread.projectId);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          startRename();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu({ x: event.clientX, y: event.clientY });
        }}
        aria-current={current ? "page" : undefined}
        className={`${rowClass} ${thread.titleRegeneration ? "opacity-55" : ""}`}
      >
        {status}
        <span className="truncate" title={thread.title}>
          {thread.title}
        </span>
      </Link>
    </li>
  );
}

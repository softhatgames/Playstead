import { threadRowInteractions } from "../hooks/threadRowInteractions.ts";
import { ProjectMenuButton } from "./sidebar/ProjectMenuButton.tsx";
import { useScratchProject } from "../hooks/useScratchProject.ts";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import { sortSidebarProjects } from "./LegacySidebar.sort.ts";
import { useReducedMotion } from "./sidebar/SidebarThreadDrag.tsx";
import { useProjectOrder, reorderProjects } from "../uiState.ts";
import type { ProjectId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { useClientSettings, updateClientSettings } from "../clientSettings.ts";
import { openCommandPalette } from "../commandPaletteBus.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { createDraft } from "../drafts.ts";
import { useThreadNavigation } from "../hooks/useThreadNavigation.ts";
import { useBulkThreadMenu } from "../hooks/useBulkThreadMenu.ts";
import { useThreadActionMenu } from "../hooks/useThreadActionMenu.ts";
import { useThreadActions } from "../hooks/useThreadActions.ts";
import { useThreadSelection } from "../threadSelection.ts";
import { failureToast } from "../toast.ts";
import {
  openProject,
  useActiveProjectId,
  useProjectExpandedById,
  resolveProjectExpanded,
  setProjectExpanded,
} from "../uiState.ts";
import { ArchiveIcon, FolderIcon, FolderPlusIcon, SquarePenIcon } from "./icons.tsx";
import { resolveProjectStatusIndicator } from "./Sidebar.logic.ts";
import {
  ThreadStatusIndicator,
  ThreadStatusDot,
  useThreadRename,
} from "./sidebar/SidebarThreadParts.tsx";
import { threadRuntimeCanArchive } from "./threadActionMenu.logic.ts";

type SidebarThread = OrchestrationV2ThreadShell;

const timeOf = (iso: string | null) => (iso === null ? 0 : Date.parse(iso) || 0);

/**
 * The project tree's thread order (T3 Code's `sortThreads`): newest first by
 * the latest message sent (`updated_at`) or by creation (`created_at`).
 */
const sortTreeThreads = (
  threads: ReadonlyArray<SidebarThread>,
  order: "updated_at" | "created_at",
) =>
  threads.toSorted((left, right) => {
    const time = (thread: SidebarThread) =>
      order === "created_at"
        ? timeOf(thread.createdAt)
        : timeOf(thread.latestRunRequestedAt) || timeOf(thread.updatedAt);
    return time(right) - time(left) || right.id.localeCompare(left.id);
  });

/**
 * **Sidebar (legacy)**: T3 Code's project tree (`apps/web/src/components/LegacySidebar.tsx`
 * at 2577baf, `SidebarProjectsContent`, `SidebarProjectItem` and
 * `SidebarProjectThreadList`), shown when **Settings → General → Sidebar
 * (legacy)** is on. Projects are listed as the server keeps them, each with
 * its threads newest first (**Settings**' thread order), the first few with
 * **Show more**. **New thread** opens a draft. A thread row renames on
 * double-click, archives from its hover button (asking inline when **Confirm
 * before archiving** is on), and opens the tree's own menu on right-click.
 * Mod-click and shift-click select several threads for the bulk menu.
 * Projects sort by update time, creation time or persisted manual order.
 * Manual order exposes drag handles; project menus rename or remove the entry.
 */
export function LegacySidebar() {
  const state = usePrimaryConnectionState();
  const { scratchWorkspaceRoot, startScratchThread } = useScratchProject();
  const projects = state?.shell?.projects;
  const threads = useMemo(() => state?.shell?.threads ?? [], [state?.shell?.threads]);
  const settings = useClientSettings();
  const projectOrder = useProjectOrder();
  const sortedProjects = sortSidebarProjects(
    projects ?? [],
    threads,
    settings.sidebarProjectSortOrder,
    projectOrder,
  );
  const manual = settings.sidebarProjectSortOrder === "manual";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const projectExpanded = useProjectExpandedById();
  const activeProjectId = useActiveProjectId();
  const { threadId: activeThreadId } = useParams({ strict: false });
  const navigate = useNavigate();
  const [expandedLists, setExpandedLists] = useState<ReadonlySet<string>>(new Set());
  const orderedThreads = sortedProjects.flatMap((project) => {
    const sorted = sortTreeThreads(
      threads.filter((thread) => thread.projectId === project.id),
      settings.sidebarThreadSortOrder,
    );
    return !resolveProjectExpanded(projectExpanded, project.id)
      ? sorted.filter((thread) => thread.id === activeThreadId)
      : expandedLists.has(project.id)
        ? sorted
        : sorted.slice(0, settings.sidebarThreadPreviewCount);
  });
  useThreadNavigation(orderedThreads.map((thread) => thread.id));
  const activeRow = useRef<HTMLButtonElement | null>(null);
  const openBulkMenu = useBulkThreadMenu({ variant: "tree", threads });

  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [activeProjectId]);

  const startThread = (projectId: ProjectId) => {
    openProject(projectId);
    void navigate({ to: "/draft/$draftId", params: { draftId: createDraft(projectId) } });
  };

  return (
    <nav aria-label="Projects" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
      <button
        type="button"
        onClick={() => openCommandPalette({ open: "root" })}
        className="mb-1 rounded-md px-2 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
      >
        Search threads and commands
      </button>
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
      <label className="px-2 text-xs text-neutral-500">
        Sort projects
        <select
          aria-label="Sort projects"
          value={settings.sidebarProjectSortOrder}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "manual" || value === "updated_at" || value === "created_at")
              void updateClientSettings({ sidebarProjectSortOrder: value }).catch((error) =>
                failureToast("Failed to save project sort", error),
              );
          }}
          className="ml-2 rounded bg-transparent py-1"
        >
          <option value="updated_at">Updated</option>
          <option value="created_at">Created</option>
          <option value="manual">Manual</option>
        </select>
      </label>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={({ active, over }) => {
          if (manual && over)
            reorderProjects(
              sortedProjects.map((p) => p.id),
              String(active.id),
              String(over.id),
            );
        }}
      >
        <SortableContext
          items={sortedProjects.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-0.5">
            {sortedProjects.map((project) => {
              const active = project.id === activeProjectId;
              return (
                <SortableProject key={project.id} id={project.id} enabled={manual}>
                  {(handle) => (
                    <>
                      <ProjectMenuButton project={project}>
                        {(openMenu, renameInput) => (
                          <div className="group flex items-center">
                            {manual ? (
                              <button
                                {...handle.attributes}
                                {...handle.listeners}
                                ref={handle.setActivatorNodeRef}
                                type="button"
                                aria-label={`Move project ${project.title}`}
                                style={{ touchAction: "none" }}
                                className="cursor-grab px-1 text-neutral-500"
                              >
                                ⠿
                              </button>
                            ) : null}
                            {renameInput ?? (
                              <button
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  openMenu({ x: event.clientX, y: event.clientY });
                                }}
                                ref={active ? activeRow : undefined}
                                type="button"
                                title={project.workspaceRoot}
                                aria-current={active ? "true" : undefined}
                                aria-expanded={resolveProjectExpanded(projectExpanded, project.id)}
                                onClick={() => {
                                  openProject(project.id);
                                  setProjectExpanded(
                                    project.id,
                                    !resolveProjectExpanded(projectExpanded, project.id),
                                  );
                                }}
                                className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                                  active
                                    ? "bg-neutral-200 font-medium dark:bg-neutral-800"
                                    : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
                                }`}
                              >
                                {resolveProjectExpanded(projectExpanded, project.id) ? (
                                  <FolderIcon className="size-3.5 shrink-0 text-neutral-500 dark:text-neutral-400" />
                                ) : (
                                  <ThreadStatusDot
                                    status={resolveProjectStatusIndicator(
                                      threads.filter((thread) => thread.projectId === project.id),
                                    )}
                                  />
                                )}
                                <span className="truncate">{project.title}</span>
                              </button>
                            )}
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
                        )}
                      </ProjectMenuButton>
                      <ProjectThreadList
                        expanded={expandedLists.has(project.id)}
                        onExpand={() =>
                          setExpandedLists((current) => {
                            const next = new Set(current);
                            if (next.has(project.id)) next.delete(project.id);
                            else next.add(project.id);
                            return next;
                          })
                        }
                        projectTitle={project.title}
                        projectExpanded={resolveProjectExpanded(projectExpanded, project.id)}
                        threads={sortTreeThreads(
                          threads.filter((thread) => thread.projectId === project.id),
                          settings.sidebarThreadSortOrder,
                        )}
                        previewCount={settings.sidebarThreadPreviewCount}
                        confirmArchive={settings.confirmThreadArchive}
                        activeThreadId={activeThreadId}
                        onBulkMenu={openBulkMenu}
                      />
                    </>
                  )}
                </SortableProject>
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
      {projects !== undefined && projects.length === 0 ? (
        <div className="px-2 pt-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
          No projects yet
          {scratchWorkspaceRoot ? (
            <button
              type="button"
              className="mt-2 block w-full underline"
              onClick={() => void startScratchThread()}
            >
              Start without a project
            </button>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

/** A project's threads, the first `previewCount` until **Show more** (T3 Code's `SidebarProjectThreadList`). */
function ProjectThreadList(props: {
  readonly expanded: boolean;
  readonly onExpand: () => void;
  readonly projectTitle: string;
  readonly projectExpanded: boolean;
  readonly threads: ReadonlyArray<SidebarThread>;
  readonly previewCount: number;
  readonly confirmArchive: boolean;
  readonly activeThreadId: string | undefined;
  readonly onBulkMenu: (position: { x: number; y: number }) => void;
}) {
  const expanded = props.expanded;
  const { threads, previewCount, activeThreadId } = props;
  if (threads.length === 0)
    return props.projectExpanded ? (
      <p className="ml-7 text-xs text-neutral-500">No threads yet</p>
    ) : null;
  const overflowing = threads.length > previewCount;
  const visible = !props.projectExpanded
    ? threads.filter((thread) => thread.id === activeThreadId)
    : expanded
      ? threads
      : threads.slice(0, previewCount);
  const orderedIds = visible.map((thread) => thread.id as string);
  return (
    <ul
      aria-label={`Threads in ${props.projectTitle}`}
      className="mt-0.5 ml-5 flex flex-col gap-0.5"
    >
      {visible.map((thread) => (
        <TreeThreadRow
          key={thread.id}
          thread={thread}
          current={thread.id === activeThreadId}
          orderedIds={orderedIds}
          confirmArchive={props.confirmArchive}
          onBulkMenu={props.onBulkMenu}
        />
      ))}
      {overflowing && props.projectExpanded ? (
        <li>
          <button
            type="button"
            onClick={props.onExpand}
            className="px-2 py-0.5 text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            {expanded ? "Show less" : "Show more"}
            {!expanded ? (
              <ThreadStatusDot
                status={resolveProjectStatusIndicator(threads.slice(previewCount))}
              />
            ) : null}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/** A thread in the tree (T3 Code's `SidebarThreadRow` in `LegacySidebar.tsx`). */
function TreeThreadRow(props: {
  readonly thread: SidebarThread;
  readonly current: boolean;
  readonly orderedIds: ReadonlyArray<string>;
  readonly confirmArchive: boolean;
  readonly onBulkMenu: (position: { x: number; y: number }) => void;
}) {
  const { thread, current } = props;
  const rename = useThreadRename(thread);
  const { openMenu } = useThreadActionMenu(thread, {
    onStartRename: rename.start,
    variant: "tree",
  });
  const { archiveThread } = useThreadActions();
  const selected = useThreadSelection().selectedThreadIds.has(thread.id);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const canArchive = threadRuntimeCanArchive(thread.status);

  const archive = () => {
    setConfirmingArchive(false);
    archiveThread(thread).catch((error: unknown) =>
      failureToast("Failed to archive thread", error),
    );
  };

  const rowClass = `${thread.titleRegeneration ? "opacity-55" : ""} group relative flex items-center gap-2 rounded-md px-2 py-1 text-sm ${
    current
      ? "bg-neutral-200 dark:bg-neutral-800"
      : selected
        ? "bg-sky-100 dark:bg-sky-950"
        : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
  }`;

  if (rename.input !== null) {
    return (
      <li>
        <div className={rowClass}>
          <ThreadStatusIndicator thread={thread} />
          {rename.input}
        </div>
      </li>
    );
  }
  return (
    <li className="group relative" onMouseLeave={() => setConfirmingArchive(false)}>
      <Link
        to="/threads/$threadId"
        params={{ threadId: thread.id }}
        data-thread-item={thread.id}
        {...threadRowInteractions({
          thread,
          orderedIds: () => props.orderedIds,
          rename: rename.start,
          bulkMenu: props.onBulkMenu,
          menu: openMenu,
        })}
        aria-current={current ? "page" : undefined}
        aria-selected={selected || undefined}
        className={`${rowClass} pr-8`}
      >
        <ThreadStatusIndicator thread={thread} />
        <span className="truncate" title={thread.title}>
          {thread.title}
        </span>
      </Link>
      {confirmingArchive ? (
        <button
          type="button"
          autoFocus
          aria-label={`Confirm archive ${thread.title}`}
          onClick={archive}
          className="absolute top-1/2 right-1 -translate-y-1/2 rounded-md bg-red-500/10 px-2 text-xs font-medium text-red-600 hover:bg-red-500/20 dark:text-red-400"
        >
          Confirm
        </button>
      ) : canArchive ? (
        <button
          type="button"
          aria-label={`Archive ${thread.title}`}
          title="Archive"
          onClick={() => (props.confirmArchive ? setConfirmingArchive(true) : archive())}
          className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 rounded p-1 text-neutral-500 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <ArchiveIcon className="size-3.5" />
        </button>
      ) : null}
    </li>
  );
}

function SortableProject(props: {
  id: string;
  enabled: boolean;
  children: (handle: ReturnType<typeof useSortable>) => ReactNode;
}) {
  const reduced = useReducedMotion();
  const sortable = useSortable({
    id: props.id,
    disabled: !props.enabled,
    transition: reduced ? null : { duration: 150, easing: "ease" },
  });
  return (
    <li
      ref={sortable.setNodeRef}
      style={{
        transform:
          reduced && !sortable.isDragging ? undefined : CSS.Transform.toString(sortable.transform),
        transition: reduced ? undefined : sortable.transition,
        position: "relative",
        zIndex: sortable.isDragging ? 10 : undefined,
      }}
    >
      {props.children(sortable)}
    </li>
  );
}

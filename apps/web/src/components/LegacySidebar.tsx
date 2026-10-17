import {
  closestCorners,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ProjectId } from "@playstead/contracts/baseSchemas";
import {
  type ClientSettings,
  type ContextMenuPosition,
  MAX_SIDEBAR_THREAD_PREVIEW_COUNT,
  MIN_SIDEBAR_THREAD_PREVIEW_COUNT,
} from "@playstead/contracts/ipc";
import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { isMacPlatform } from "@playstead/shared/keybindings";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { updateClientSettings, useClientSettings } from "../clientSettings.ts";
import { copyTextToClipboard } from "../clipboard.ts";
import { openCommandPalette } from "../commandPaletteBus.ts";
import { readPrimaryServerSettings, usePrimaryConnectionState } from "../connection/runtime.ts";
import { createDraft } from "../drafts.ts";
import { useBulkThreadMenu } from "../hooks/useBulkThreadMenu.ts";
import { type ProjectActionTarget, removeProjectFromTree } from "../hooks/useProjectActions.ts";
import { useSidebarThreadShortcuts } from "../hooks/useSidebarThreadShortcuts.ts";
import { useThreadActionMenu } from "../hooks/useThreadActionMenu.ts";
import { useThreadActions } from "../hooks/useThreadActions.ts";
import { keybindings, shortcutLabelForCommand } from "../keybindings.ts";
import {
  clearThreadSelection,
  rangeSelectThreadsTo,
  readThreadSelection,
  setThreadSelectionAnchor,
  toggleThreadSelection,
  useThreadSelection,
} from "../threadSelection.ts";
import { sortThreads } from "../threadSort.ts";
import { openProject, setProjectOrder, useActiveProjectId, useProjectOrder } from "../uiState.ts";
import {
  ArchiveIcon,
  ArrowUpDownIcon,
  CheckIcon,
  FolderIcon,
  FolderPlusIcon,
  SearchIcon,
  SquarePenIcon,
} from "./icons.tsx";
import { isTrailingDoubleClick, reorderProjects, sortTreeProjects } from "./Sidebar.logic.ts";
import { readLocalApi } from "../localApi.ts";
import { failureToast, successToast } from "../toast.ts";
import { projectMenuItems } from "./projectActions.logic.ts";
import { ProjectRenameDialog } from "./sidebar/ProjectRenameDialog.tsx";
import {
  JumpHintBadge,
  ThreadStatusIndicator,
  useThreadRename,
} from "./sidebar/SidebarThreadParts.tsx";
import { threadRuntimeCanArchive } from "./threadActionMenu.logic.ts";
import { visibleTreeThreads } from "./threadNavigation.logic.ts";

type SidebarThread = OrchestrationV2ThreadShell;

/**
 * **Sidebar (legacy)**: T3 Code's project tree (`apps/web/src/components/LegacySidebar.tsx`
 * at 2577baf, `SidebarProjectsContent`, `SidebarProjectItem` and
 * `SidebarProjectThreadList`), shown when **Settings → General → Sidebar
 * (legacy)** is on. **Sidebar options** sorts the projects by their latest
 * message, by creation, or by hand (**Manual**, where a project's header
 * drags it; the order is kept in the ui state), and sets each project's
 * thread order and how many show before **Show more**. **New thread** opens
 * a draft. A thread row renames on double-click, archives from its hover
 * button (asking inline when **Confirm before archiving** is on), and opens
 * the tree's own menu on right-click. Mod-click and shift-click select
 * several threads for the bulk menu. A project's right-click menu offers
 * **Rename**, **Copy Path**, **Project settings** and **Remove**.
 * **Search** at the top opens the command palette. `mod+shift+[` and `]`
 * move through the threads as shown, and `mod+1` to `mod+9` open the
 * first nine in the desktop app.
 */
export function LegacySidebar() {
  const state = usePrimaryConnectionState();
  const projects = state?.shell?.projects;
  const threads = useMemo(() => state?.shell?.threads ?? [], [state?.shell?.threads]);
  const settings = useClientSettings();
  const activeProjectId = useActiveProjectId();
  const { threadId: activeThreadId } = useParams({ strict: false });
  const navigate = useNavigate();
  const activeRow = useRef<HTMLButtonElement | null>(null);
  const openBulkMenu = useBulkThreadMenu({ variant: "tree", threads });

  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [activeProjectId]);

  const startThread = (projectId: ProjectId) => {
    openProject(projectId);
    void navigate({
      to: "/draft/$draftId",
      params: { draftId: createDraft(projectId, readPrimaryServerSettings()) },
    });
  };

  const [renaming, setRenaming] = useState<ProjectActionTarget | null>(null);
  // T3 Code's `handleProjectButtonContextMenu`.
  const openProjectMenu = async (project: ProjectActionTarget, position: ContextMenuPosition) => {
    const chosen = await readLocalApi()
      .contextMenu.show(projectMenuItems, position)
      .catch(() => null);
    switch (chosen) {
      case "rename":
        setRenaming(project);
        return;
      case "copy-path":
        await copyTextToClipboard(project.workspaceRoot).then(
          () => successToast("Path copied", project.workspaceRoot),
          (error: unknown) => failureToast("Failed to copy path", error),
        );
        return;
      case "project-settings":
        await navigate({ to: "/projects/$projectKey", params: { projectKey: project.id } });
        return;
      case "delete":
        removeProjectFromTree(project);
        return;
      case null:
        return;
    }
  };

  const projectOrder = useProjectOrder();
  const sortOrder = settings.sidebarProjectSortOrder;
  const manualSorting = sortOrder === "manual";
  const sortedProjects = useMemo(
    () => sortTreeProjects({ projects: projects ?? [], threads, sortOrder, projectOrder }),
    [projects, threads, sortOrder, projectOrder],
  );
  const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(new Set());
  const toggleProjectExpanded = (projectId: string) =>
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (!next.delete(projectId)) next.add(projectId);
      return next;
    });
  const threadsByProject = useMemo(() => {
    const byProject = new Map<string, ReadonlyArray<SidebarThread>>();
    for (const project of sortedProjects) {
      byProject.set(
        project.id,
        sortThreads(
          threads.filter((thread) => thread.projectId === project.id),
          settings.sidebarThreadSortOrder,
        ),
      );
    }
    return byProject;
  }, [sortedProjects, threads, settings.sidebarThreadSortOrder]);
  const visibleThreads = useMemo(
    () =>
      visibleTreeThreads({
        projects: sortedProjects,
        threadsByProject,
        previewCount: settings.sidebarThreadPreviewCount,
        expandedProjectIds,
        activeThreadId,
      }),
    [
      sortedProjects,
      threadsByProject,
      settings.sidebarThreadPreviewCount,
      expandedProjectIds,
      activeThreadId,
    ],
  );
  const jumpLabels = useSidebarThreadShortcuts(visibleThreads, activeThreadId);
  const searchShortcut = shortcutLabelForCommand(keybindings, "commandPalette.toggle");
  const projectSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  // The project under the pointer, else the nearest corner (T3 Code's).
  const projectCollisionDetection: CollisionDetection = (args) => {
    const under = pointerWithin(args);
    return under.length > 0 ? under : closestCorners(args);
  };
  // The click that ends a project drag must not open the project.
  const suppressProjectClick = useRef(false);
  const handleProjectDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    setProjectOrder(
      reorderProjects(
        sortedProjects.map((project) => project.id as string),
        String(active.id),
        String(over.id),
      ),
    );
  };

  const renderProject = (
    project: OrchestrationProjectShell,
    handle: SortableProjectHandle | null,
  ) => {
    const active = project.id === activeProjectId;
    return (
      <>
        <div className="group flex items-center">
          <button
            ref={(node) => {
              if (active) activeRow.current = node;
              handle?.setActivatorNodeRef(node);
            }}
            type="button"
            title={project.workspaceRoot}
            aria-current={active ? "true" : undefined}
            {...(handle === null ? {} : { ...handle.attributes, ...handle.listeners })}
            onPointerDown={(event) => {
              // A new press starts clean; a drag it becomes swallows its own click.
              suppressProjectClick.current = false;
              handle?.listeners?.onPointerDown?.(event);
            }}
            onClick={() => {
              if (suppressProjectClick.current) {
                suppressProjectClick.current = false;
                return;
              }
              openProject(project.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              void openProjectMenu(project, { x: event.clientX, y: event.clientY });
            }}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
              active
                ? "bg-neutral-200 font-medium dark:bg-neutral-800"
                : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
            }${handle === null ? "" : " cursor-grab active:cursor-grabbing"}`}
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
        <ProjectThreadList
          projectTitle={project.title}
          threads={threadsByProject.get(project.id) ?? []}
          visibleThreads={visibleThreads.filter((thread) => thread.projectId === project.id)}
          expanded={expandedProjectIds.has(project.id)}
          onToggleExpanded={() => toggleProjectExpanded(project.id)}
          jumpLabels={jumpLabels}
          previewCount={settings.sidebarThreadPreviewCount}
          confirmArchive={settings.confirmThreadArchive}
          activeThreadId={activeThreadId}
          onBulkMenu={openBulkMenu}
        />
      </>
    );
  };

  return (
    <nav aria-label="Projects" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
      <button
        type="button"
        onClick={() => openCommandPalette()}
        className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
      >
        <SearchIcon className="size-3.5 shrink-0" />
        <span className="flex-1 truncate">Search</span>
        {searchShortcut === null ? null : (
          <kbd className="text-xs text-neutral-500 dark:text-neutral-400">{searchShortcut}</kbd>
        )}
      </button>
      <div className="mb-1 flex items-center justify-between pr-1 pl-2">
        <span className="flex-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          Projects
        </span>
        <ProjectSortMenu
          projectSortOrder={sortOrder}
          threadSortOrder={settings.sidebarThreadSortOrder}
          threadPreviewCount={settings.sidebarThreadPreviewCount}
        />
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
      {manualSorting ? (
        <DndContext
          sensors={projectSensors}
          collisionDetection={projectCollisionDetection}
          modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
          onDragStart={() => {
            suppressProjectClick.current = true;
          }}
          onDragEnd={handleProjectDragEnd}
        >
          <SortableContext
            items={sortedProjects.map((project) => project.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-0.5">
              {sortedProjects.map((project) => (
                <SortableProjectItem key={project.id} projectId={project.id}>
                  {(handle) => renderProject(project, handle)}
                </SortableProjectItem>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {sortedProjects.map((project) => (
            <li key={project.id}>{renderProject(project, null)}</li>
          ))}
        </ul>
      )}
      {projects !== undefined && projects.length === 0 ? (
        <div className="px-2 pt-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
          No projects yet
        </div>
      ) : null}
      <ProjectRenameDialog project={renaming} onClose={() => setRenaming(null)} />
    </nav>
  );
}

/** A project's threads, the first `previewCount` until **Show more** (T3 Code's `SidebarProjectThreadList`). */
function ProjectThreadList(props: {
  readonly projectTitle: string;
  readonly threads: ReadonlyArray<SidebarThread>;
  /** The threads shown, from `visibleTreeThreads`; the thread in view stays while folded. */
  readonly visibleThreads: ReadonlyArray<SidebarThread>;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  readonly jumpLabels: ReadonlyMap<string, string>;
  readonly previewCount: number;
  readonly confirmArchive: boolean;
  readonly activeThreadId: string | undefined;
  readonly onBulkMenu: (position: { x: number; y: number }) => void;
}) {
  const { threads, expanded, activeThreadId } = props;
  if (threads.length === 0) return null;
  const overflowing = threads.length > props.previewCount;
  const visible = props.visibleThreads;
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
          jumpLabel={props.jumpLabels.get(thread.id) ?? null}
          confirmArchive={props.confirmArchive}
          onBulkMenu={props.onBulkMenu}
        />
      ))}
      {overflowing ? (
        <li>
          <button
            type="button"
            onClick={props.onToggleExpanded}
            className="px-2 py-0.5 text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

type SortableProjectHandle = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

/** A project the tree can drag by its header, in manual order (T3 Code's `SortableProjectItem`). */
function SortableProjectItem(props: {
  readonly projectId: string;
  readonly children: (handle: SortableProjectHandle) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: props.projectId });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative rounded-md ${isDragging ? "z-20 opacity-80" : ""} ${
        isOver && !isDragging ? "ring-1 ring-sky-500/40 ring-inset" : ""
      }`}
    >
      {props.children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}

const PROJECT_SORT_LABELS: Record<ClientSettings["sidebarProjectSortOrder"], string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};
const THREAD_SORT_LABELS: Record<ClientSettings["sidebarThreadSortOrder"], string> = {
  updated_at: "Last user message",
  created_at: "Created at",
};

const saveSetting = (patch: Partial<ClientSettings>) =>
  updateClientSettings(patch).catch((error: unknown) =>
    failureToast("Failed to save sidebar options", error),
  );

/**
 * **Sidebar options** (T3 Code's `ProjectSortMenu`): how projects are
 * sorted (by the latest message, by creation, or **Manual**, where they
 * can be dragged), how each project's threads are sorted, and how many
 * show before **Show more**.
 */
function ProjectSortMenu(props: {
  readonly projectSortOrder: ClientSettings["sidebarProjectSortOrder"];
  readonly threadSortOrder: ClientSettings["sidebarThreadSortOrder"];
  readonly threadPreviewCount: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const setPreviewCount = (count: number) => {
    const clamped = Math.min(
      MAX_SIDEBAR_THREAD_PREVIEW_COUNT,
      Math.max(MIN_SIDEBAR_THREAD_PREVIEW_COUNT, Math.round(count)),
    );
    if (Number.isFinite(clamped) && clamped !== props.threadPreviewCount) {
      void saveSetting({ sidebarThreadPreviewCount: clamped });
    }
  };
  const radio = <V extends string>(
    value: V,
    label: string,
    checked: boolean,
    choose: (value: V) => void,
  ) => (
    <button
      key={value}
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={() => choose(value)}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
    >
      <span className="flex size-3.5 items-center justify-center">
        {checked ? <CheckIcon className="size-3.5" /> : null}
      </span>
      {label}
    </button>
  );
  const groupLabel = "px-2 pt-2 pb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400";
  const stepButton =
    "rounded px-1.5 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Sidebar options"
        title="Sidebar options"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        <ArrowUpDownIcon className="size-3.5" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Sidebar options"
          className="absolute top-full right-0 z-20 mt-1 w-52 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div role="group" aria-label="Sort projects">
            <div className={`${groupLabel} pt-1`}>Sort projects</div>
            {(
              Object.entries(PROJECT_SORT_LABELS) as Array<
                [ClientSettings["sidebarProjectSortOrder"], string]
              >
            ).map(([value, label]) =>
              radio(value, label, props.projectSortOrder === value, (choice) =>
                saveSetting({ sidebarProjectSortOrder: choice }),
              ),
            )}
          </div>
          <div role="group" aria-label="Sort threads">
            <div className={groupLabel}>Sort threads</div>
            {(
              Object.entries(THREAD_SORT_LABELS) as Array<
                [ClientSettings["sidebarThreadSortOrder"], string]
              >
            ).map(([value, label]) =>
              radio(value, label, props.threadSortOrder === value, (choice) =>
                saveSetting({ sidebarThreadSortOrder: choice }),
              ),
            )}
          </div>
          <div role="group" aria-label="Visible threads">
            <div className={groupLabel}>Visible threads</div>
            <div className="flex items-center gap-1 px-2 py-1">
              <button
                type="button"
                aria-label="Decrease visible thread count"
                disabled={props.threadPreviewCount <= MIN_SIDEBAR_THREAD_PREVIEW_COUNT}
                onClick={() => setPreviewCount(props.threadPreviewCount - 1)}
                className={stepButton}
              >
                −
              </button>
              <input
                aria-label="Visible thread count"
                inputMode="numeric"
                key={props.threadPreviewCount}
                defaultValue={props.threadPreviewCount}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setPreviewCount(Number(event.currentTarget.value));
                }}
                onBlur={(event) => setPreviewCount(Number(event.currentTarget.value))}
                className="w-12 rounded-md bg-neutral-100 px-2 py-0.5 text-center text-sm tabular-nums outline-none dark:bg-neutral-800"
              />
              <button
                type="button"
                aria-label="Increase visible thread count"
                disabled={props.threadPreviewCount >= MAX_SIDEBAR_THREAD_PREVIEW_COUNT}
                onClick={() => setPreviewCount(props.threadPreviewCount + 1)}
                className={stepButton}
              >
                +
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Mod-click on a Mac is Command, elsewhere Control (T3 Code's `isModClick`). */
export const isModClick = (event: Pick<MouseEvent, "metaKey" | "ctrlKey">) =>
  isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;

/** A thread in the tree (T3 Code's `SidebarThreadRow` in `LegacySidebar.tsx`). */
function TreeThreadRow(props: {
  readonly thread: SidebarThread;
  readonly current: boolean;
  readonly orderedIds: ReadonlyArray<string>;
  readonly jumpLabel: string | null;
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

  const rowClass = `group relative flex items-center gap-2 rounded-md px-2 py-1 text-sm ${
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
        onClick={(event) => {
          if (isModClick(event)) {
            event.preventDefault();
            toggleThreadSelection(thread.id);
            return;
          }
          if (event.shiftKey) {
            event.preventDefault();
            rangeSelectThreadsTo(thread.id, props.orderedIds);
            return;
          }
          if (isTrailingDoubleClick(event.detail)) {
            event.preventDefault();
            return;
          }
          clearThreadSelection();
          setThreadSelectionAnchor(thread.id);
          openProject(thread.projectId);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          rename.start();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          const position = { x: event.clientX, y: event.clientY };
          if (readThreadSelection().selectedThreadIds.has(thread.id)) {
            props.onBulkMenu(position);
            return;
          }
          clearThreadSelection();
          openMenu(position);
        }}
        aria-current={current ? "page" : undefined}
        aria-selected={selected || undefined}
        className={`${rowClass} pr-8`}
      >
        <ThreadStatusIndicator thread={thread} />
        {/* Dimmed while a provider writes the title (T3 Code's `opacity-55`). */}
        <span
          className={`truncate${thread.titleRegeneration === null ? "" : " opacity-55"}`}
          title={thread.title}
        >
          {thread.title}
        </span>
        {props.jumpLabel === null ? null : <JumpHintBadge label={props.jumpLabel} />}
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

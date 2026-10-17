import type { ProjectId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { isMacPlatform } from "@playstead/shared/keybindings";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";

import { useClientSettings } from "../clientSettings.ts";
import { openCommandPalette } from "../commandPaletteBus.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { createDraft } from "../drafts.ts";
import { useBulkThreadMenu } from "../hooks/useBulkThreadMenu.ts";
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
import { failureToast } from "../toast.ts";
import { openProject, useActiveProjectId } from "../uiState.ts";
import { ArchiveIcon, FolderIcon, FolderPlusIcon, SearchIcon, SquarePenIcon } from "./icons.tsx";
import { isTrailingDoubleClick } from "./Sidebar.logic.ts";
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
 * (legacy)** is on. Projects are listed as the server keeps them, each with
 * its threads newest first (**Settings**' thread order), the first few with
 * **Show more**. **New thread** opens a draft. A thread row renames on
 * double-click, archives from its hover button (asking inline when **Confirm
 * before archiving** is on), and opens the tree's own menu on right-click.
 * Mod-click and shift-click select several threads for the bulk menu.
 * **Search** at the top opens the command palette. `mod+shift+[` and `]`
 * move through the threads as shown, and `mod+1` to `mod+9` open the
 * first nine in the desktop app.
 * Project sorting and dragging come with #40, and the project menu with #44.
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
  const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(new Set());
  const toggleProjectExpanded = (projectId: string) =>
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (!next.delete(projectId)) next.add(projectId);
      return next;
    });
  const threadsByProject = useMemo(() => {
    const byProject = new Map<string, ReadonlyArray<SidebarThread>>();
    for (const project of projects ?? []) {
      byProject.set(
        project.id,
        sortThreads(
          threads.filter((thread) => thread.projectId === project.id),
          settings.sidebarThreadSortOrder,
        ),
      );
    }
    return byProject;
  }, [projects, threads, settings.sidebarThreadSortOrder]);
  const visibleThreads = useMemo(
    () =>
      visibleTreeThreads({
        projects: projects ?? [],
        threadsByProject,
        previewCount: settings.sidebarThreadPreviewCount,
        expandedProjectIds,
        activeThreadId,
      }),
    [
      projects,
      threadsByProject,
      settings.sidebarThreadPreviewCount,
      expandedProjectIds,
      activeThreadId,
    ],
  );
  const jumpLabels = useSidebarThreadShortcuts(visibleThreads, activeThreadId);
  const searchShortcut = shortcutLabelForCommand(keybindings, "commandPalette.toggle");

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
  const visible = props.visibleThreads;
  const overflowing = threads.length > props.previewCount;
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

import type { ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useClientSettings } from "../clientSettings.ts";
import { openCommandPalette } from "../commandPaletteBus.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { createDraft } from "../drafts.ts";
import { useBulkThreadMenu } from "../hooks/useBulkThreadMenu.ts";
import { useThreadActionMenu } from "../hooks/useThreadActionMenu.ts";
import { settleThread, confirmAndUnpinThread, unsettleThread } from "../hooks/useThreadActions.ts";
import { registerSettleAndAdvance } from "../settleAndAdvance.ts";
import {
  clearThreadSelection,
  rangeSelectThreadsTo,
  readThreadSelection,
  setThreadSelectionAnchor,
  toggleThreadSelection,
  useThreadSelection,
} from "../threadSelection.ts";
import { failureToast } from "../toast.ts";
import {
  openProject,
  readActiveProjectId,
  setSidebarProjectScopeKey,
  useSidebarProjectScopeKey,
  useSidebarShelvesExpanded,
  toggleSidebarShelfExpanded,
} from "../uiState.ts";
import {
  CheckIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  ListFilterIcon,
  PinIcon,
  PinOffIcon,
  SquarePenIcon,
  Undo2Icon,
} from "./icons.tsx";
import { isModClick } from "./LegacySidebar.tsx";
import {
  buildSidebarProjectGroups,
  buildSidebarSections,
  compactTimeLabel,
  createInboxReturnTracker,
  resolveSidebarProjectScope,
  type SidebarProjectGroup,
  type SidebarSection,
  threadAfterPark,
} from "./Sidebar.inbox.logic.ts";
import { isTrailingDoubleClick } from "./Sidebar.logic.ts";
import { ThreadStatusIndicator, useThreadRename } from "./sidebar/SidebarThreadParts.tsx";

type SidebarThread = OrchestrationV2ThreadShell;

const SETTLED_TAIL_INITIAL_COUNT = 10;
const SETTLED_TAIL_PAGE_COUNT = 25;
// Return order survives route remounts.
const inboxReturns = createInboxReturnTracker();

/**
 * The inbox sidebar, Playstead's default (T3 Code's `apps/web/src/components/Sidebar.tsx`
 * at 2577baf). One flat list in sections: **Pinned** on top, then **Active**,
 * the optional **Working** shelf (beta, **Settings → General**), and the
 * **Settled** shelf, folded by default. The header scopes it to one project
 * (or the "No project" group), adds a project and starts a thread. Rows
 * show their status, settle or un-settle from a hover button, unpin from
 * the pin, rename on double-click and open the thread menu on right-click.
 * Mod-click and shift-click select several rows for the bulk menu. Unpin,
 * settle and archive show **Undo** below it (`AppSidebarLayout`).
 *
 * Seams for the slice's later tickets: **Snoozed** goes between Working and
 * Settled (#38), thread search in the header (#41), dragging between and
 * within sections (#40), and **New thread in…** from the palette (#42).
 */
export function Sidebar() {
  const state = usePrimaryConnectionState();
  const projects = useMemo(() => state?.shell?.projects ?? [], [state?.shell?.projects]);
  const threads = useMemo(() => state?.shell?.threads ?? [], [state?.shell?.threads]);
  const settings = useClientSettings();
  const workingShelfEnabled = settings.sidebarWorkingShelfEnabled;
  const { threadId: routeThreadId } = useParams({ strict: false });
  const navigate = useNavigate();

  const groups = useMemo(
    () =>
      buildSidebarProjectGroups({
        projects,
        threads,
        sortOrder: settings.sidebarProjectSortOrder,
      }),
    [projects, threads, settings.sidebarProjectSortOrder],
  );
  const scopeKey = useSidebarProjectScopeKey();
  const scopedGroup = resolveSidebarProjectScope(groups, scopeKey);
  const scopedProjectIds = useMemo(
    () => (scopedGroup === null ? null : new Set<string>(scopedGroup.projectIds)),
    [scopedGroup],
  );
  useEffect(() => clearThreadSelection(), [scopeKey]);

  const sections = useMemo(() => {
    inboxReturns.observe(workingShelfEnabled ? threads : null, Date.now());
    return buildSidebarSections({
      threads,
      scopedProjectIds,
      workingShelfEnabled,
      returnedAt: inboxReturns.returnedAt,
    });
  }, [threads, scopedProjectIds, workingShelfEnabled]);

  const { settled: settledExpanded, working: workingExpanded } = useSidebarShelvesExpanded();
  const toggleSettled = () => toggleSidebarShelfExpanded("settled");
  const toggleWorking = () => toggleSidebarShelfExpanded("working");
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_TAIL_INITIAL_COUNT);
  useEffect(() => setSettledVisibleCount(SETTLED_TAIL_INITIAL_COUNT), [scopeKey]);

  // A folded shelf still shows the thread in view.
  const shelfRows = (rows: ReadonlyArray<SidebarThread>, expanded: boolean) =>
    expanded ? rows : rows.filter((thread) => thread.id === routeThreadId);
  const settledPage = sections.settled.slice(0, settledVisibleCount);
  const settledTail = sections.settled
    .slice(settledVisibleCount)
    .filter((thread) => thread.id === routeThreadId);
  const visibleSettled = shelfRows([...settledPage, ...settledTail], settledExpanded);
  const hiddenSettledCount = sections.settled.length - settledPage.length - settledTail.length;
  const visibleWorking = shelfRows(sections.working, workingExpanded);

  const orderedThreads = useMemo(
    () => [...sections.pinned, ...sections.active, ...visibleWorking, ...visibleSettled],
    [sections.pinned, sections.active, visibleWorking, visibleSettled],
  );
  const orderedIds = useMemo(() => orderedThreads.map((thread) => thread.id), [orderedThreads]);
  const orderedIdsRef = useRef(orderedIds);
  orderedIdsRef.current = orderedIds;
  const settledIdsRef = useRef(new Set<string>());
  settledIdsRef.current = new Set(sections.settled.map((thread) => thread.id));
  const routeThreadIdRef = useRef(routeThreadId);
  routeThreadIdRef.current = routeThreadId;

  /**
   * Settles a thread; settling the one in view moves to the next thread not
   * settled, or a new draft in its project (T3 Code's `attemptSettle` with
   * `planForwardNavigation`). `coSettling` are settled with it.
   */
  const attemptSettle = useCallback(
    (
      thread: Pick<SidebarThread, "id" | "projectId" | "pinnedAt" | "pinOrderKey">,
      coSettling?: ReadonlySet<string>,
    ) => {
      const viewing = routeThreadIdRef.current === thread.id;
      const next = viewing
        ? threadAfterPark({
            orderedIds: orderedIdsRef.current,
            parkedIds: settledIdsRef.current,
            threadId: thread.id,
            ...(coSettling === undefined ? {} : { coParkingIds: coSettling }),
          })
        : null;
      settleThread(thread).then(
        () => {
          if (!viewing || routeThreadIdRef.current !== thread.id) return;
          void (next === null
            ? navigate({
                to: "/draft/$draftId",
                params: { draftId: createDraft(thread.projectId) },
              })
            : navigate({ to: "/threads/$threadId", params: { threadId: next as ThreadId } }));
        },
        (error: unknown) => failureToast("Failed to settle thread", error),
      );
    },
    [navigate],
  );
  const threadsById = useMemo(
    () => new Map(threads.map((thread) => [thread.id as string, thread])),
    [threads],
  );
  const threadsByIdRef = useRef(threadsById);
  threadsByIdRef.current = threadsById;
  useEffect(
    () =>
      registerSettleAndAdvance((target) => {
        const thread = threadsByIdRef.current.get(target.id);
        if (thread !== undefined) attemptSettle(thread);
      }),
    [attemptSettle],
  );
  const settleThreads = useCallback(
    (targets: ReadonlyArray<SidebarThread>) => {
      const coSettling = new Set<string>(targets.map((thread) => thread.id));
      for (const thread of targets) attemptSettle(thread, coSettling);
    },
    [attemptSettle],
  );
  const openBulkMenu = useBulkThreadMenu({
    variant: "inbox",
    threads: orderedThreads,
    settleThreads,
  });

  const startNewThread = () => {
    // T3 Code opens **New thread in…** with several projects unless Shift
    // is held; until the palette has that mode (#42), it starts in the
    // current project: the thread in view's or the last opened, while the
    // scope shows it; otherwise the scope's, or the first project.
    const routeThread = routeThreadId === undefined ? undefined : threadsById.get(routeThreadId);
    const inScope = (projectId: string | undefined) =>
      projectId !== undefined && (scopedProjectIds === null || scopedProjectIds.has(projectId));
    const current = [routeThread?.projectId, readActiveProjectId()].find(inScope) as
      | ProjectId
      | undefined;
    const projectId = current ?? scopedGroup?.projectIds[0] ?? groups[0]?.projectIds[0];
    if (projectId === undefined) return;
    openProject(projectId);
    void navigate({ to: "/draft/$draftId", params: { draftId: createDraft(projectId) } });
  };

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id as string, project.title])),
    [projects],
  );
  const renderRow = (thread: SidebarThread, section: SidebarSection) => (
    <InboxThreadRow
      key={thread.id}
      thread={thread}
      section={section}
      current={thread.id === routeThreadId}
      projectName={scopedGroup === null ? (projectNameById.get(thread.projectId) ?? null) : null}
      orderedIdsRef={orderedIdsRef}
      onSettle={attemptSettle}
      onBulkMenu={openBulkMenu}
    />
  );

  const total =
    sections.pinned.length +
    sections.active.length +
    sections.working.length +
    sections.settled.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-2 pb-1">
        <span className="min-w-0 flex-1 truncate pl-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {scopedGroup === null ? "Threads" : scopedGroup.displayName}
        </span>
        {groups.length > 0 ? (
          <>
            <ProjectScopeMenu groups={groups} scopedGroup={scopedGroup} />
            <HeaderButton
              label="Add project"
              onClick={() => openCommandPalette({ open: "add-project" })}
            >
              <FolderPlusIcon className="size-4" />
            </HeaderButton>
          </>
        ) : null}
        <HeaderButton label="New thread" disabled={projects.length === 0} onClick={startNewThread}>
          <SquarePenIcon className="size-4" />
        </HeaderButton>
      </div>
      <nav aria-label="Threads" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        {total === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-neutral-500 dark:text-neutral-400">
            {projects.length === 0 ? (
              <>
                <span>No projects yet</span>
                <button
                  type="button"
                  onClick={() => openCommandPalette({ open: "add-project" })}
                  className="rounded-md border border-neutral-300 px-2.5 py-1 font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
                >
                  Add project
                </button>
              </>
            ) : scopedGroup !== null ? (
              `No threads in ${scopedGroup.displayName} yet`
            ) : (
              "No threads yet"
            )}
          </div>
        ) : (
          <ul role="presentation" className="flex flex-1 flex-col gap-px">
            {sections.pinned.length > 0 ? (
              <SectionLabel label="Pinned">
                {sections.pinned.map((thread) => renderRow(thread, "pinned"))}
              </SectionLabel>
            ) : null}
            <SectionLabel label="Active">
              {sections.active.map((thread) => renderRow(thread, "active"))}
            </SectionLabel>
            <li className="mt-auto" aria-hidden />
            {sections.working.length > 0 ? (
              <ShelfHeader
                label={workingExpanded ? "Working" : `Working (${sections.working.length})`}
                expanded={workingExpanded}
                onToggle={toggleWorking}
              />
            ) : null}
            {visibleWorking.map((thread) => renderRow(thread, "working"))}
            <ShelfHeader
              label={settledExpanded ? "Settled" : `Settled (${sections.settled.length})`}
              expanded={settledExpanded}
              onToggle={toggleSettled}
            />
            {visibleSettled.map((thread) => renderRow(thread, "settled"))}
            {settledExpanded && hiddenSettledCount > 0 ? (
              <li>
                <button
                  type="button"
                  onClick={() => setSettledVisibleCount((count) => count + SETTLED_TAIL_PAGE_COUNT)}
                  className="w-full rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
                >
                  Show {Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT)} more
                </button>
              </li>
            ) : null}
          </ul>
        )}
      </nav>
    </div>
  );
}

function HeaderButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="rounded p-1.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
    >
      {props.children}
    </button>
  );
}

/**
 * A section's rows. T3 Code shows the Pinned and Active labels only while
 * dragging (#40); here they name the groups for assistive technology.
 */
function SectionLabel(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <li className="list-none">
      <ul aria-label={props.label} className="flex flex-col gap-px">
        {props.children}
      </ul>
    </li>
  );
}

/** A shelf's header, which folds and unfolds it (T3 Code's `SidebarSectionHeader`). */
function ShelfHeader(props: {
  readonly label: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <li className="list-none">
      <button
        type="button"
        aria-expanded={props.expanded}
        onClick={props.onToggle}
        className="flex h-8 w-full items-center gap-1 rounded-md px-2 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        <ChevronRightIcon
          className={`size-3 transition-transform motion-reduce:transition-none ${props.expanded ? "rotate-90" : ""}`}
        />
        {props.label}
      </button>
    </li>
  );
}

/**
 * The project scope menu (T3 Code's `Combobox` in the sidebar header):
 * **All projects** or one group, with **Search projects...** to narrow it.
 */
function ProjectScopeMenu(props: {
  readonly groups: ReadonlyArray<SidebarProjectGroup>;
  readonly scopedGroup: SidebarProjectGroup | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const items = [
    { key: null, label: "All projects" },
    ...props.groups.map((group) => ({ key: group.key, label: group.displayName })),
  ];
  const trimmed = query.trim().toLowerCase();
  const shown =
    trimmed.length === 0
      ? items
      : items.filter((item) => item.key !== null && item.label.toLowerCase().includes(trimmed));
  const choose = (key: string | null) => {
    setSidebarProjectScopeKey(key);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className="relative">
      <HeaderButton
        label={
          props.scopedGroup === null
            ? "Filter threads by project"
            : `Filter threads by project: ${props.scopedGroup.displayName}`
        }
        onClick={() => {
          setOpen((value) => !value);
          setQuery("");
        }}
      >
        {props.scopedGroup === null ? (
          <ListFilterIcon className="size-4" />
        ) : (
          <FolderIcon className="size-4 text-sky-600 dark:text-sky-400" />
        )}
      </HeaderButton>
      {open ? (
        <div className="absolute top-full -right-16 z-20 mt-1 w-60 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <input
            autoFocus
            aria-label="Search projects"
            placeholder="Search projects..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              } else if (event.key === "Enter" && shown[0] !== undefined) {
                event.preventDefault();
                choose(shown[0].key);
              }
            }}
            className="mb-1 w-full rounded-md bg-neutral-100 px-2 py-1 text-sm outline-none dark:bg-neutral-800"
          />
          {shown.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-neutral-500">No matching projects.</div>
          ) : (
            <ul role="listbox" aria-label="Projects">
              {shown.map((item) => {
                const selected = (props.scopedGroup?.key ?? null) === item.key;
                return (
                  <li
                    key={item.key ?? "all"}
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(item.key)}
                    className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                      selected ? "font-medium" : ""
                    }`}
                  >
                    <FolderIcon className="size-4 shrink-0 text-neutral-500" />
                    <span className="truncate">{item.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A row (T3 Code's `SidebarThreadRow`): a card in Pinned, Active and
 * Working, a slim row in Settled. Its hover button settles it, or
 * un-settles a settled one; a pinned row's pin unpins it.
 */
function InboxThreadRow(props: {
  readonly thread: SidebarThread;
  readonly section: SidebarSection;
  readonly current: boolean;
  /** Shown when the sidebar spans several projects. */
  readonly projectName: string | null;
  readonly orderedIdsRef: { readonly current: ReadonlyArray<string> };
  readonly onSettle: (thread: SidebarThread) => void;
  readonly onBulkMenu: (position: { x: number; y: number }) => void;
}) {
  const { thread, section, current } = props;
  const rename = useThreadRename(thread);
  const { openMenu } = useThreadActionMenu(thread, {
    onStartRename: rename.start,
    projectFilter: true,
  });
  const selected = useThreadSelection().selectedThreadIds.has(thread.id);
  const settled = section === "settled";
  const pinned = thread.pinnedAt !== null;
  const now = Date.now();
  const timeLabel = compactTimeLabel(
    settled
      ? (thread.settledAt ?? thread.updatedAt)
      : (thread.latestRunRequestedAt ?? thread.updatedAt),
    now,
  );

  const surface = current
    ? "bg-neutral-200 dark:bg-neutral-800"
    : selected
      ? "bg-sky-100 dark:bg-sky-950"
      : "hover:bg-neutral-100 dark:hover:bg-neutral-900";
  const rowClass = `group relative flex w-full items-center gap-2 rounded-md px-2.5 text-left text-sm ${
    settled ? "h-8 text-neutral-500 dark:text-neutral-400" : "min-h-9 py-1.5"
  } ${surface}`;

  if (rename.input !== null) {
    return (
      <li className="list-none">
        <div className={rowClass}>
          <ThreadStatusIndicator thread={thread} />
          {rename.input}
        </div>
      </li>
    );
  }

  return (
    <li className="group relative list-none">
      <Link
        to="/threads/$threadId"
        params={{ threadId: thread.id }}
        data-thread-item={thread.id}
        aria-current={current ? "page" : undefined}
        aria-selected={selected || undefined}
        onClick={(event) => {
          if (isModClick(event)) {
            event.preventDefault();
            toggleThreadSelection(thread.id);
            return;
          }
          if (event.shiftKey) {
            event.preventDefault();
            rangeSelectThreadsTo(thread.id, props.orderedIdsRef.current);
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
        className={`${rowClass} pr-9`}
      >
        <ThreadStatusIndicator thread={thread} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate" title={thread.title}>
            {thread.title}
          </span>
          {props.projectName !== null && !settled ? (
            <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {props.projectName}
            </span>
          ) : null}
        </span>
        {pinned ? <span className="size-3 shrink-0" aria-hidden /> : null}
        <span className="shrink-0 text-xs text-neutral-500 tabular-nums group-hover:opacity-0 dark:text-neutral-400">
          {timeLabel}
        </span>
      </Link>
      {pinned ? (
        <button
          type="button"
          aria-label="Unpin thread"
          title="Unpin thread"
          onClick={() =>
            confirmAndUnpinThread(thread).catch((error: unknown) =>
              failureToast("Failed to unpin thread", error),
            )
          }
          className="group/unpin absolute top-1/2 right-9 -translate-y-1/2 rounded-sm text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          <PinIcon className="size-3 group-hover/unpin:hidden" />
          <PinOffIcon className="hidden size-3 group-hover/unpin:block" />
        </button>
      ) : null}
      {settled ? (
        <button
          type="button"
          aria-label="Un-settle thread"
          title="Un-settle thread"
          onClick={() =>
            unsettleThread(thread.id).catch((error: unknown) =>
              failureToast("Failed to un-settle thread", error),
            )
          }
          className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1.5 text-neutral-500 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <Undo2Icon className="size-3.5" />
        </button>
      ) : (
        <button
          type="button"
          aria-label="Settle thread"
          title="Settle thread"
          onClick={() => props.onSettle(thread)}
          className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1.5 text-neutral-500 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <CheckIcon className="size-3.5" />
        </button>
      )}
    </li>
  );
}

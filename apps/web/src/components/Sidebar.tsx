import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { useParams } from "@tanstack/react-router";
import { type MouseEvent as ReactMouseEvent, useCallback, useMemo, useRef } from "react";

import { useClientSettings } from "../clientSettings.ts";
import { openCommandPalette } from "../commandPaletteBus.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { useBulkThreadMenu } from "../hooks/useBulkThreadMenu.ts";
import { useHandleNewThread } from "../hooks/useHandleNewThread.ts";
import { useSidebarParking } from "../hooks/useSidebarParking.ts";
import { useSidebarProjectScope, useSidebarSections } from "../hooks/useSidebarSections.ts";
import { useSidebarThreadDrag, useOptimisticDrop } from "../hooks/useSidebarThreadDrag.ts";
import { useSidebarThreadSearch } from "../hooks/useSidebarThreadSearch.ts";
import { useSidebarThreadShortcuts } from "../hooks/useSidebarThreadShortcuts.ts";
import { keybindings, shortcutLabelForCommand } from "../keybindings.ts";
import { SidebarInboxList } from "./sidebar/SidebarInboxList.tsx";
import { SidebarThreadHeader } from "./sidebar/SidebarThreadHeader.tsx";
import { SidebarSearchResults } from "./sidebar/SidebarThreadSearch.tsx";
import { shouldCreateNewThreadInCurrentProject } from "./threadNavigation.logic.ts";

type SidebarThread = OrchestrationV2ThreadShell;

/**
 * The inbox sidebar, Playstead's default (T3 Code's `apps/web/src/components/Sidebar.tsx`
 * at 2577baf). One flat list in sections: **Pinned** on top, then **Active**,
 * the optional **Working** shelf (beta, **Settings → General**), and the
 * **Snoozed** and **Settled** shelves, folded by default. The header scopes
 * it to one project (or the "No project" group), adds a project and starts
 * a thread. Rows show their status, snooze, settle, un-settle or wake from
 * hover buttons, unpin from the pin, rename on double-click and open the
 * thread menu on right-click. Mod-click and shift-click select several rows
 * for the bulk menu. Unpin, settle, snooze and archive show **Undo** below
 * it (`AppSidebarLayout`). A snoozed thread leaves Snoozed when its time
 * comes, with no event: the sidebar sets a timer for the earliest wake.
 * **Search threads** in the header replaces the list with the threads whose
 * title or messages hold the query, chosen with the arrow keys and Enter.
 *
 * Rows drag within Pinned and Active to reorder them, and between sections
 * to pin, unpin, settle, un-settle or wake (out of Snoozed only), showing
 * what the drop will do; pressed and dragged, a row's Settle, Un-settle or
 * Wake button acts on every row it crosses.
 *
 * **New thread** opens **New thread in…** in the command palette when there
 * are several project groups, unless Shift is held. `mod+shift+[` and `]`
 * move through the rows as shown, and `mod+1` to `mod+9` open the first
 * nine in the desktop app, whose rows show their keys while the modifier
 * is held.
 *
 * The pieces: `hooks/useSidebarSections.ts` (scope, sections, shelves),
 * `useSidebarParking.ts` (settle and snooze, moving the view on),
 * `useSidebarThreadDrag.ts` (dragging and sweeping), `useSidebarThreadSearch.ts`,
 * and `sidebar/SidebarThreadHeader.tsx`, `SidebarInboxList.tsx` and
 * `SidebarInboxThreadRow.tsx`.
 */
export function Sidebar() {
  const state = usePrimaryConnectionState();
  const projects = useMemo(() => state?.shell?.projects ?? [], [state?.shell?.projects]);
  const threads = useMemo(() => state?.shell?.threads ?? [], [state?.shell?.threads]);
  const workingShelfEnabled = useClientSettings().sidebarWorkingShelfEnabled;
  const { threadId: routeThreadId } = useParams({ strict: false });

  const { groups, scopeKey, scopedGroup, scopedProjectIds } = useSidebarProjectScope(
    projects,
    threads,
  );
  const { projectedThreads, dropPending, setOptimisticDrop } = useOptimisticDrop(threads);
  const view = useSidebarSections({
    threads,
    projectedThreads,
    scopedProjectIds,
    scopeKey,
    routeThreadId,
  });
  const { sections, orderedThreads } = view;

  const orderedIds = useMemo(() => orderedThreads.map((thread) => thread.id), [orderedThreads]);
  const orderedIdsRef = useRef(orderedIds);
  orderedIdsRef.current = orderedIds;
  const parkedIds = useMemo(
    () => new Set<string>([...sections.settled, ...sections.snoozed].map((thread) => thread.id)),
    [sections.settled, sections.snoozed],
  );
  const threadsById = useMemo(
    () => new Map(threads.map((thread) => [thread.id as string, thread])),
    [threads],
  );

  const parking = useSidebarParking({ orderedIds, parkedIds, threadsById, routeThreadId });
  const openBulkMenu = useBulkThreadMenu({
    variant: "inbox",
    threads: orderedThreads,
    settleThreads: parking.settleThreads,
    snoozeThreads: parking.snoozeThreads,
  });
  const drag = useSidebarThreadDrag({
    threads,
    threadsById,
    view,
    scopedProjectIds,
    workingShelfEnabled,
    routeThreadId,
    setOptimisticDrop,
    attemptSettle: parking.attemptSettle,
    settleThreads: parking.settleThreads,
  });
  const search = useSidebarThreadSearch(sections);
  const jumpLabels = useSidebarThreadShortcuts(orderedThreads, routeThreadId);

  // In the current project while the scope shows it: the thread in view's,
  // the draft's or the last opened; otherwise the scope's first.
  const newThread = useHandleNewThread({ scopedProjectIds });
  const startNewThread = (event: ReactMouseEvent) => {
    if (!shouldCreateNewThreadInCurrentProject(event.shiftKey, groups.length)) {
      openCommandPalette({ open: "new-thread-in" });
      return;
    }
    void newThread.startFromContext();
  };
  const newThreadShortcut =
    shortcutLabelForCommand(keybindings, "chat.new") ??
    (groups.length <= 1 ? shortcutLabelForCommand(keybindings, "chat.newLocal") : null);

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id as string, project.title])),
    [projects],
  );
  const projectNameOf = useCallback(
    (thread: SidebarThread) =>
      scopedGroup === null ? (projectNameById.get(thread.projectId) ?? null) : null,
    [scopedGroup, projectNameById],
  );

  const total =
    sections.pinned.length +
    sections.active.length +
    sections.working.length +
    sections.snoozed.length +
    sections.settled.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarThreadHeader
        search={search}
        groups={groups}
        scopedGroup={scopedGroup}
        canStartThread={projects.length > 0}
        newThreadShortcut={newThreadShortcut}
        onNewThread={startNewThread}
      />
      <nav aria-label="Threads" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        {search.isSearching ? (
          <SidebarSearchResults
            search={search}
            routeThreadId={routeThreadId}
            projectNameOf={projectNameOf}
          />
        ) : total === 0 ? (
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
          <SidebarInboxList
            view={view}
            drag={drag}
            dropPending={dropPending}
            projectedThreads={projectedThreads}
            routeThreadId={routeThreadId}
            projectNameOf={projectNameOf}
            orderedIdsRef={orderedIdsRef}
            jumpLabels={jumpLabels}
            onSettle={parking.attemptSettle}
            onSnooze={parking.attemptSnooze}
            onBulkMenu={openBulkMenu}
          />
        )}
      </nav>
    </div>
  );
}

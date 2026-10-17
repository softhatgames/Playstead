import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { type ReactNode, useMemo } from "react";

import type { SidebarSectionsView } from "../../hooks/useSidebarSections.ts";
import type { SidebarThreadDrag } from "../../hooks/useSidebarThreadDrag.ts";
import {
  resolveSidebarDropVerb,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarListSection,
} from "../Sidebar.drag.logic.ts";
import { SidebarDragLifecycle } from "../Sidebar.pointer.ts";
import { InboxThreadRow, SortableThreadRow } from "./SidebarInboxThreadRow.tsx";
import {
  SidebarDragBoundary,
  SidebarSectionPlaceholder,
  SidebarShelfHeader,
} from "./SidebarListMarkers.tsx";

type SidebarThread = OrchestrationV2ThreadShell;

/**
 * The inbox's one flat list (T3 Code's `DndContext` list in
 * `apps/web/src/components/Sidebar.tsx` at 2577baf): the sections' rows
 * with the labels, placeholders and shelf headers between them, and
 * **Show N more** under an open Settled.
 */
export function SidebarInboxList(props: {
  readonly view: SidebarSectionsView;
  readonly drag: SidebarThreadDrag;
  /** True while a drop is on its way to the server: no row drags until it lands. */
  readonly dropPending: boolean;
  readonly projectedThreads: ReadonlyArray<SidebarThread>;
  readonly routeThreadId: string | undefined;
  /** Each thread's project name, or null when the sidebar is scoped to one group. */
  readonly projectNameOf: (thread: SidebarThread) => string | null;
  readonly orderedIdsRef: { readonly current: ReadonlyArray<string> };
  readonly jumpLabels: ReadonlyMap<string, string>;
  readonly onSettle: (thread: SidebarThread) => void;
  readonly onSnooze: (thread: SidebarThread, snoozedUntil: string) => void;
  readonly onBulkMenu: (position: { x: number; y: number }) => void;
}) {
  const { view, drag } = props;
  const { sections, shelves, visibleSettled } = view;
  const { dragState, actionSweep } = drag;
  const dragTargetSection = dragState?.targetSection ?? null;
  const draggingFrom = dragState?.activeSection ?? null;
  const projectedById = useMemo(
    () => new Map(props.projectedThreads.map((thread) => [thread.id as string, thread])),
    [props.projectedThreads],
  );

  const renderRow = (thread: SidebarThread, section: SidebarListSection) => (
    <SortableThreadRow
      key={thread.id}
      id={thread.id}
      // Working follows live status, so its rows stay put; so does every
      // row while a drop is on its way.
      disabled={section === "working" || props.dropPending}
    >
      {(sortable) => (
        <InboxThreadRow
          thread={thread}
          section={section}
          current={thread.id === props.routeThreadId}
          projectName={props.projectNameOf(thread)}
          orderedIdsRef={props.orderedIdsRef}
          jumpLabel={props.jumpLabels.get(thread.id) ?? null}
          sortable={sortable}
          dropVerb={
            dragState?.activeKey === thread.id
              ? resolveSidebarDropVerb(dragState.activeSection, dragTargetSection)
              : null
          }
          dragOverPinned={dragState?.activeKey === thread.id && dragTargetSection === "pinned"}
          sweepAction={actionSweep?.keys.has(thread.id) ? actionSweep.action : null}
          onSettle={props.onSettle}
          onSnooze={props.onSnooze}
          onActionSweepStart={drag.startActionSweep}
          onBulkMenu={props.onBulkMenu}
        />
      )}
    </SortableThreadRow>
  );

  const firstShelf =
    sections.working.length > 0
      ? "working-header"
      : sections.snoozed.length > 0
        ? "snoozed-header"
        : "settled-header";
  // An empty section's placeholder shows while dragging, and while its last row is dragged out.
  const placeholderHint = (section: "active" | "settled", rowCount: number) =>
    draggingFrom !== null &&
    (rowCount === 0 ||
      (draggingFrom === section &&
        rowCount === 1 &&
        dragTargetSection !== null &&
        dragTargetSection !== section));
  const shelfLabel = (label: string, expanded: boolean, count: number) =>
    expanded ? label : `${label} (${count})`;

  const renderMarker = (marker: SidebarListMarker): ReactNode => {
    const shelfClass = firstShelf === marker ? "mt-auto" : undefined;
    switch (marker) {
      case "pinned-header":
      case "pinned-divider":
        return (
          <SidebarDragBoundary
            key={marker}
            marker={marker}
            label={marker === "pinned-header" ? "Pinned" : "Active"}
            visible={draggingFrom !== null}
            isDropTarget={dragTargetSection === (marker === "pinned-header" ? "pinned" : "active")}
          />
        );
      case "active-placeholder":
        return (
          <SidebarSectionPlaceholder
            key={marker}
            marker={marker}
            label="Active"
            showHint={placeholderHint("active", sections.active.length)}
            isDropTarget={dragTargetSection === "active"}
          />
        );
      case "settled-placeholder":
        return (
          <SidebarSectionPlaceholder
            key={marker}
            marker={marker}
            label="Settled"
            showHint={placeholderHint("settled", visibleSettled.length)}
            isDropTarget={dragTargetSection === "settled"}
          />
        );
      case "working-header":
        return (
          <SidebarShelfHeader
            key={marker}
            marker={marker}
            className={shelfClass}
            label={shelfLabel("Working", shelves.working.expanded, sections.working.length)}
            expanded={shelves.working.expanded}
            onToggle={shelves.working.toggle}
          />
        );
      case "snoozed-header":
        return (
          <SidebarShelfHeader
            key={marker}
            marker={marker}
            className={shelfClass}
            label={shelfLabel("Snoozed", shelves.snoozed.expanded, sections.snoozed.length)}
            expanded={shelves.snoozed.expanded}
            onToggle={shelves.snoozed.toggle}
            tone="info"
            dragging={draggingFrom !== null}
          />
        );
      case "settled-header":
        return (
          <SidebarShelfHeader
            key={marker}
            marker={marker}
            className={shelfClass}
            label={shelfLabel("Settled", shelves.settled.expanded, sections.settled.length)}
            expanded={shelves.settled.expanded}
            onToggle={shelves.settled.toggle}
            dragging={draggingFrom !== null}
            isDropTarget={dragTargetSection === "settled"}
          />
        );
    }
  };
  const renderListItem = (item: SidebarListItem): ReactNode => {
    if (item.kind === "marker") return renderMarker(item.marker);
    const thread = projectedById.get(item.key);
    return thread === undefined ? null : renderRow(thread, item.section);
  };

  return (
    <DndContext {...drag.dndContextProps}>
      <SidebarDragLifecycle onUnmount={drag.cancelThreadDrag} />
      <SortableContext items={drag.sortableIds} strategy={drag.sortingStrategy}>
        <ul
          ref={drag.attachThreadList}
          // A presentational list keeps assistive technology reading
          // the rows in order (T3 Code's VoiceOver note).
          role="presentation"
          className={`relative flex flex-1 flex-col gap-px${
            actionSweep === null ? "" : " **:pointer-events-none"
          }`}
        >
          {drag.listItems.map(renderListItem)}
          {shelves.settled.expanded && view.hiddenSettledCount > 0 ? (
            <li className="list-none">
              <button
                type="button"
                onClick={view.showMoreSettled}
                className="w-full rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
              >
                Show {Math.min(view.hiddenSettledCount, view.settledPageCount)} more
              </button>
            </li>
          ) : null}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

import { ChevronRightIcon } from "../icons.tsx";
import { animateSidebarLayoutChanges } from "../Sidebar.drag.ts";
import { type SidebarListMarker, sidebarMarkerId } from "../Sidebar.drag.logic.ts";

/**
 * The inbox list's rows between sections (T3 Code's `SortableSidebarMarker`,
 * `SidebarDragBoundary`, `SidebarSectionPlaceholder` and
 * `SidebarSectionHeader` in `apps/web/src/components/Sidebar.tsx` at
 * 2577baf). Each slides with the rows but is never dragged.
 */

function SortableSidebarMarker(props: {
  readonly marker: SidebarListMarker;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  const { setNodeRef, transform, transition } = useSortable({
    id: sidebarMarkerId(props.marker),
    disabled: { draggable: true },
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  return (
    <li
      ref={setNodeRef}
      data-sidebar-marker={sidebarMarkerId(props.marker)}
      className={`list-none ${props.className ?? ""}`}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: props.marker.endsWith("-placeholder") ? "none" : transition,
        visibility: transform?.scaleY === 0 ? "hidden" : undefined,
      }}
    >
      {props.children}
    </li>
  );
}

/** The Pinned and Active labels, shown only while dragging; they take no room until then. */
export function SidebarDragBoundary(props: {
  readonly marker: "pinned-header" | "pinned-divider";
  readonly label: string;
  readonly visible: boolean;
  readonly isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      className="pointer-events-none relative mx-0.5 -mb-px h-0"
    >
      {props.visible ? (
        <div className="sidebar-drag-boundary-label absolute inset-x-2 top-1 flex h-4 items-center gap-2">
          <span
            className={`shrink-0 text-xs font-medium ${
              props.isDropTarget ? "text-sky-600 dark:text-sky-400" : "text-neutral-500"
            }`}
          >
            {props.label}
          </span>
          <span
            aria-hidden
            className={`h-px flex-1 ${
              props.isDropTarget ? "bg-sky-500/50" : "bg-neutral-400/40 dark:bg-neutral-600/50"
            }`}
          />
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

/** Somewhere to drop into an empty Active or Settled. */
export function SidebarSectionPlaceholder(props: {
  readonly marker: "active-placeholder" | "settled-placeholder";
  readonly label: string;
  readonly showHint: boolean;
  readonly isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker marker={props.marker} className="relative mx-0.5 -mb-px h-0">
      {props.showHint ? (
        <div
          className={`absolute inset-x-0 top-0 flex h-9 items-center justify-center rounded-md border border-dashed text-xs ${
            props.isDropTarget
              ? "border-sky-500/50 bg-sky-500/5 text-sky-600 dark:text-sky-400"
              : "border-neutral-400/40 text-neutral-500"
          }`}
        >
          {props.label}
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

/**
 * A shelf's header, which folds and unfolds it. While dragging it stands
 * out, and takes the accent colour when the drop would land in its shelf.
 */
export function SidebarShelfHeader(props: {
  readonly marker: "working-header" | "snoozed-header" | "settled-header";
  readonly label: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly className?: string | undefined;
  readonly dragging?: boolean;
  readonly isDropTarget?: boolean;
  /** Snoozed's header is tinted, as T3 Code's "info" tone. */
  readonly tone?: "muted" | "info";
}) {
  const tone = props.isDropTarget
    ? "text-sky-600 dark:text-sky-400"
    : props.dragging
      ? "text-neutral-900 dark:text-neutral-100"
      : props.tone === "info"
        ? "text-sky-700 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-200"
        : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100";
  return (
    <SortableSidebarMarker marker={props.marker} className={`h-8 ${props.className ?? ""}`}>
      <button
        type="button"
        aria-expanded={props.expanded}
        onClick={props.onToggle}
        className={`flex h-8 w-full items-center gap-1 rounded-md px-2 text-xs font-medium ${tone}`}
      >
        <ChevronRightIcon
          className={`size-3 transition-transform motion-reduce:transition-none ${props.expanded ? "rotate-90" : ""}`}
        />
        {props.label}
      </button>
    </SortableSidebarMarker>
  );
}

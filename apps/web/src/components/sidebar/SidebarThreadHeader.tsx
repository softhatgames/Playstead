import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { openCommandPalette } from "../../commandPaletteBus.ts";
import type { SidebarThreadSearchState } from "../../hooks/useSidebarThreadSearch.ts";
import type { SidebarProjectGroup } from "../../sidebarProjectGrouping.ts";
import { FolderPlusIcon, SquarePenIcon } from "../icons.tsx";
import { SidebarProjectScopeMenu } from "./SidebarProjectScopeMenu.tsx";
import { SidebarSearchField } from "./SidebarThreadSearch.tsx";

/**
 * The inbox sidebar's header (T3 Code's `apps/web/src/components/sidebar/SidebarThreadHeader.tsx`
 * at 2577baf): **Search threads**, the project scope, **Add project** and
 * **New thread**.
 */
export function SidebarThreadHeader(props: {
  readonly search: SidebarThreadSearchState;
  readonly groups: ReadonlyArray<SidebarProjectGroup>;
  readonly scopedGroup: SidebarProjectGroup | null;
  readonly canStartThread: boolean;
  readonly newThreadShortcut: string | null;
  readonly onNewThread: (event: ReactMouseEvent) => void;
}) {
  const { search } = props;
  return (
    <div className="flex items-center gap-1 px-2 pb-1">
      <SidebarSearchField
        inputRef={search.inputRef}
        query={search.query}
        onQueryChange={search.setQuery}
        onKeyDown={search.onKeyDown}
        isSearching={search.isSearching}
        resultCount={search.results.length}
        activeIndex={search.activeIndex}
        onClear={search.clear}
      />
      {props.groups.length > 0 ? (
        <>
          <SidebarProjectScopeMenu groups={props.groups} scopedGroup={props.scopedGroup} />
          <SidebarHeaderIconButton
            label="Add project"
            onClick={() => openCommandPalette({ open: "add-project" })}
          >
            <FolderPlusIcon className="size-4" />
          </SidebarHeaderIconButton>
        </>
      ) : null}
      <SidebarHeaderIconButton
        label="New thread"
        {...(props.newThreadShortcut === null ? {} : { shortcut: props.newThreadShortcut })}
        disabled={!props.canStartThread}
        onClick={props.onNewThread}
      >
        <SquarePenIcon className="size-4" />
      </SidebarHeaderIconButton>
    </div>
  );
}

/** An icon button in the header, titled with its label and shortcut (T3 Code's `SidebarHeaderIconButton`). */
export function SidebarHeaderIconButton(props: {
  readonly label: string;
  /** Shown with the label on hover. */
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly onClick: (event: ReactMouseEvent) => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.shortcut === undefined ? props.label : `${props.label} (${props.shortcut})`}
      disabled={props.disabled}
      onClick={props.onClick}
      className="rounded p-1.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
    >
      {props.children}
    </button>
  );
}

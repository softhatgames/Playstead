import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import type { OrchestrationThreadSearchMatch } from "@playstead/contracts/threadSearch";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

import { SearchIcon, XIcon } from "../icons.tsx";
import { compactTimeLabel } from "../Sidebar.logic.ts";
import { ThreadSearchMatchExcerpt } from "../ThreadSearchMatch.tsx";
import { ThreadStatusIndicator } from "./SidebarThreadParts.tsx";

export const SEARCH_RESULTS_ID = "sidebar-thread-search-results";
export const searchResultId = (index: number) => `sidebar-thread-search-result-${index}`;

/**
 * **Search threads** in the sidebar's header (T3 Code's
 * `SidebarThreadHeader` at 2577baf): a combobox over the results below it,
 * with a button that clears it.
 */
export function SidebarSearchField(props: {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  readonly isSearching: boolean;
  readonly resultCount: number;
  readonly activeIndex: number;
  readonly onClear: () => void;
}) {
  const resultsVisible = props.isSearching && props.resultCount > 0;
  // The list shrinks as the query narrows; never point at a row that is gone.
  const activeExists = resultsVisible && props.activeIndex < props.resultCount;
  return (
    <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100">
      <SearchIcon className="size-4 shrink-0" />
      <input
        ref={props.inputRef}
        type="search"
        value={props.query}
        onChange={(event) => props.onQueryChange(event.currentTarget.value)}
        onKeyDown={props.onKeyDown}
        placeholder="Search"
        aria-label="Search threads"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={resultsVisible}
        aria-controls={resultsVisible ? SEARCH_RESULTS_ID : undefined}
        aria-activedescendant={activeExists ? searchResultId(props.activeIndex) : undefined}
        className="min-w-0 flex-1 bg-transparent text-neutral-900 outline-none placeholder:text-neutral-500 dark:text-neutral-100 [&::-webkit-search-cancel-button]:hidden"
      />
      {props.isSearching ? (
        <button
          type="button"
          aria-label="Clear thread search"
          title="Clear thread search"
          onClick={() => {
            props.onClear();
            props.inputRef.current?.focus();
          }}
          className="shrink-0 rounded p-0.5 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * A search result (T3 Code's `SidebarSearchResultRow`): the thread's
 * status, title and time, the project when the sidebar spans several, and
 * the matching message when it matched by one. The pointer highlights it;
 * a click opens the thread.
 */
export function SidebarSearchResultRow(props: {
  readonly thread: OrchestrationV2ThreadShell;
  readonly index: number;
  readonly isSettled: boolean;
  readonly isHighlighted: boolean;
  readonly isCurrent: boolean;
  readonly projectName: string | null;
  readonly match: OrchestrationThreadSearchMatch | null;
  readonly query: string;
  readonly onHighlight: () => void;
  readonly onSelect: () => void;
}) {
  const { thread } = props;
  const lit = props.isHighlighted || props.isCurrent;
  return (
    <li role="presentation" className="list-none">
      <button
        id={searchResultId(props.index)}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={props.isHighlighted}
        aria-current={props.isCurrent ? "page" : undefined}
        aria-label={
          props.projectName === null ? thread.title : `${thread.title}, ${props.projectName}`
        }
        onMouseMove={props.onHighlight}
        onClick={props.onSelect}
        className={`flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1 text-left text-sm outline-none ${
          lit
            ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
            : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
        }`}
      >
        <ThreadStatusIndicator thread={thread} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              className={`min-w-0 flex-1 truncate ${
                props.isSettled && !lit ? "text-neutral-500 dark:text-neutral-400" : "font-medium"
              }${thread.titleRegeneration === null ? "" : " opacity-55"}`}
            >
              {thread.title}
            </span>
            <span className="w-8 shrink-0 text-right text-xs text-neutral-500 tabular-nums dark:text-neutral-400">
              {compactTimeLabel(thread.latestRunRequestedAt ?? thread.updatedAt, Date.now())}
            </span>
          </span>
          {props.projectName !== null ? (
            <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {props.projectName}
            </span>
          ) : null}
          {props.match === null ? null : (
            <ThreadSearchMatchExcerpt match={props.match} query={props.query} />
          )}
        </span>
      </button>
    </li>
  );
}

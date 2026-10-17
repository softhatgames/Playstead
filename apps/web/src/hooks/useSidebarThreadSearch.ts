import type { OrchestrationThreadSearchMatch } from "@playstead/contracts/threadSearch";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { useNavigate } from "@tanstack/react-router";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  moveSearchHighlight,
  searchSidebarThreads,
  type SidebarSections,
} from "../components/Sidebar.logic.ts";
import { searchResultId } from "../components/sidebar/SidebarThreadSearch.tsx";
import { useThreadSearch } from "../connection/useThreadSearch.ts";
import { openProject } from "../uiState.ts";

type SidebarThread = OrchestrationV2ThreadShell;

export interface SidebarThreadSearchState {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly isSearching: boolean;
  /** Still waiting for the server's message matches. */
  readonly isPending: boolean;
  readonly results: ReadonlyArray<SidebarThread>;
  readonly matchById: ReadonlyMap<string, OrchestrationThreadSearchMatch>;
  readonly activeIndex: number;
  readonly setActiveIndex: (index: number) => void;
  readonly clear: () => void;
  readonly select: (thread: SidebarThread) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
}

/**
 * **Search threads** in the inbox header (T3 Code's sidebar search): every
 * thread in scope, folded shelves included, whose title or messages hold
 * the query, in the sidebar's order. The arrow keys move the highlight,
 * Enter opens the highlighted thread and clears the search, and Escape
 * clears it.
 */
export function useSidebarThreadSearch(sections: SidebarSections): SidebarThreadSearchState {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQueryState] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const isSearching = query.trim().length > 0;
  const threadSearch = useThreadSearch(query);
  const matchById = useMemo(
    () => new Map(threadSearch.matches.map((match) => [match.threadId as string, match])),
    [threadSearch.matches],
  );
  const results = useMemo(
    () =>
      searchSidebarThreads(
        [
          ...sections.pinned,
          ...sections.active,
          ...sections.working,
          ...sections.snoozed,
          ...sections.settled,
        ],
        query,
        new Set(matchById.keys()),
      ),
    [sections, query, matchById],
  );
  const resultOrder = results.map((thread) => thread.id).join(" ");
  useEffect(() => setActiveIndex(0), [resultOrder]);
  useEffect(() => {
    if (!isSearching) return;
    document.getElementById(searchResultId(activeIndex))?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isSearching, resultOrder]);

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setActiveIndex(0);
  }, []);
  const clear = useCallback(() => setQuery(""), [setQuery]);
  const select = (thread: SidebarThread) => {
    clear();
    openProject(thread.projectId);
    void navigate({ to: "/threads/$threadId", params: { threadId: thread.id } });
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && isSearching) {
      event.preventDefault();
      // The layout's Escape would clear the selection too.
      event.stopPropagation();
      clear();
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? "down" : "up";
      setActiveIndex((index) => moveSearchHighlight(index, results.length, direction));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = results[activeIndex];
      if (result !== undefined) select(result);
    }
  };

  return {
    inputRef,
    query,
    setQuery,
    isSearching,
    isPending: threadSearch.isPending,
    results,
    matchById,
    activeIndex,
    setActiveIndex,
    clear,
    select,
    onKeyDown,
  };
}

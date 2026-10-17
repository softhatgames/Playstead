import { searchThreads } from "@playstead/client-runtime/state/threadSearch";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useThreadSearch } from "../../hooks/useThreadSearch.ts";
import { clearThreadSelection, setThreadSelectionAnchor } from "../../threadSelection.ts";

/** Header search replaces the inbox list; clearing it restores its shelves and scope. */
export function SidebarThreadSearch({
  threads,
  projects,
  actions,
  children,
}: {
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly actions: ReactNode;
  readonly children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const messages = useThreadSearch(query);
  const matches = new Map(messages.matches.map((match) => [match.threadId, match]));
  const results = searchThreads(threads, query, new Set(matches.keys()));
  const searching = query.trim().length > 0;
  const order = results.map((thread) => thread.id).join("\0");
  useEffect(() => setActive(0), [order]);
  useEffect(() => {
    if (searching)
      document
        .getElementById(`thread-search-result-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, order, searching]);
  const clear = () => {
    setQuery("");
    setActive(0);
  };
  const select = (thread: OrchestrationV2ThreadShell) => {
    clear();
    clearThreadSelection();
    setThreadSelectionAnchor(thread.id);
    void navigate({ to: "/threads/$threadId", params: { threadId: thread.id } });
  };
  return (
    <>
      <div className="flex items-center gap-1 px-2 pb-1">
        <div className="flex min-w-0 flex-1 items-center rounded-md px-2 focus-within:bg-neutral-100 dark:focus-within:bg-neutral-900">
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-label="Search threads"
            aria-autocomplete="list"
            aria-expanded={searching && results.length > 0}
            aria-controls={searching && results.length > 0 ? "thread-search-results" : undefined}
            aria-activedescendant={
              searching && results[active] ? `thread-search-result-${active}` : undefined
            }
            placeholder="Search threads"
            value={query}
            className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none [&::-webkit-search-cancel-button]:appearance-none"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "Escape" && searching) {
                event.preventDefault();
                event.stopPropagation();
                clear();
              }
              if (!results.length) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive(
                  (index) =>
                    (index + (event.key === "ArrowDown" ? 1 : -1) + results.length) %
                    results.length,
                );
              }
              if (event.key === "Enter" && results[active]) {
                event.preventDefault();
                select(results[active]);
              }
            }}
          />
          {searching ? (
            <button
              type="button"
              aria-label="Clear thread search"
              className="px-1 text-neutral-500"
              onClick={() => {
                clear();
                input.current?.focus();
              }}
            >
              ×
            </button>
          ) : null}
        </div>
        {actions}
      </div>
      {searching ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {results.length > 0 ? (
            <div role="listbox" id="thread-search-results" aria-label="Thread search results">
              {results.map((thread, index) => {
                const match = matches.get(thread.id);
                return (
                  <button
                    key={thread.id}
                    id={`thread-search-result-${index}`}
                    type="button"
                    role="option"
                    aria-selected={active === index}
                    className={`mb-px flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left text-xs ${active === index ? "bg-neutral-200 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-900"}`}
                    onMouseEnter={() => setActive(index)}
                    onFocus={() => setActive(index)}
                    onClick={() => select(thread)}
                  >
                    <span className="w-full truncate font-medium">{thread.title}</span>
                    <span className="w-full truncate text-neutral-500">
                      {projects.find((project) => project.id === thread.projectId)?.title ??
                        "No project"}
                    </span>
                    {match ? (
                      <span className="line-clamp-2 break-words text-neutral-500">
                        <span className="font-medium">
                          {match.source === "user" ? "You" : "Assistant"}:{" "}
                        </span>
                        {match.snippet}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div role="status" className="px-2 py-3 text-xs text-neutral-500">
            {messages.error ??
              (messages.isPending
                ? "Searching thread messages…"
                : results.length === 0
                  ? "No threads found"
                  : "")}
          </div>
        </div>
      ) : (
        children
      )}
    </>
  );
}

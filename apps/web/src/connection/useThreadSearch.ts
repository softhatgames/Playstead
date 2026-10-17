import type { OrchestrationThreadSearchMatch } from "@playstead/contracts/threadSearch";
import { useEffect, useState } from "react";

import { requestPrimary, usePrimaryConnectionState } from "./runtime.ts";

const THREAD_SEARCH_DEBOUNCE_MS = 200;
const THREAD_SEARCH_MIN_LENGTH = 2;
const NO_MATCHES: ReadonlyArray<OrchestrationThreadSearchMatch> = Object.freeze([]);

function useDebouncedValue<A>(value: A, delayMs: number): A {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

interface Answer {
  readonly query: string;
  readonly matches: ReadonlyArray<OrchestrationThreadSearchMatch>;
}

/**
 * Threads whose messages hold `query`, from the server (T3 Code's
 * `useThreadSearch` in `apps/web/src/state/queries.ts` at 2577baf), for the
 * sidebar's search and the command palette's Threads group. It asks once
 * the trimmed query has two characters and has stayed the same for 200 ms.
 * While typing or waiting there are no matches and `isPending` is true;
 * `query` is the query the matches answer, or "" when there are none. A
 * failed search finds nothing. Titles are matched by the caller.
 */
export function useThreadSearch(query: string): {
  readonly matches: ReadonlyArray<OrchestrationThreadSearchMatch>;
  readonly query: string;
  readonly isPending: boolean;
} {
  const connected = usePrimaryConnectionState()?.phase === "connected";
  const normalized = query.trim();
  const debounced = useDebouncedValue(normalized, THREAD_SEARCH_DEBOUNCE_MS);
  const canSearch = connected && normalized.length >= THREAD_SEARCH_MIN_LENGTH;
  const settled = canSearch && normalized === debounced ? debounced : null;
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (settled === null) return;
    let current = true;
    const answerWith = (matches: ReadonlyArray<OrchestrationThreadSearchMatch>) => {
      if (current) setAnswer({ query: settled, matches });
    };
    requestPrimary((client) => client["orchestration.searchThreads"]({ query: settled })).then(
      (result) => answerWith(result.matches),
      () => answerWith(NO_MATCHES),
    );
    return () => {
      current = false;
    };
  }, [settled]);

  const answered = settled !== null && answer?.query === settled ? answer : null;
  return {
    matches: answered?.matches ?? NO_MATCHES,
    query: answered?.query ?? "",
    isPending: canSearch && answered === null,
  };
}

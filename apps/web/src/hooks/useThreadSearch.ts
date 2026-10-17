import type { OrchestrationThreadSearchMatch } from "@playstead/contracts/threadSearch";
import { useEffect, useState } from "react";
import { requestPrimary } from "../connection/runtime.ts";

const EMPTY_MATCHES: ReadonlyArray<OrchestrationThreadSearchMatch> = [];

/** Shared message search for the sidebar and command palette. */
export function useThreadSearch(query: string) {
  const normalized = query.trim();
  const enabled = normalized.length >= 2 && normalized.length <= 200;
  const [result, setResult] = useState<{
    query: string;
    matches: ReadonlyArray<OrchestrationThreadSearchMatch>;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void requestPrimary((client) =>
        client["orchestration.searchThreads"]({ query: normalized }),
      ).then(
        ({ matches }) => {
          if (!cancelled) setResult({ query: normalized, matches, error: null });
        },
        () => {
          if (!cancelled)
            setResult({
              query: normalized,
              matches: EMPTY_MATCHES,
              error: "Unable to search thread messages.",
            });
        },
      );
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, normalized]);
  const current = enabled && result?.query === normalized ? result : null;
  return {
    matches: current?.matches ?? EMPTY_MATCHES,
    isPending: enabled && current === null,
    error:
      normalized.length > 200
        ? "Use at most 200 characters to search messages."
        : (current?.error ?? null),
  };
}

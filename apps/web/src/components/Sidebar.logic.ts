import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

/**
 * Whether the thread shows the unseen-completion dot (T3 Code's
 * `hasUnseenCompletion` in `apps/web/src/components/Sidebar.logic.ts` at
 * 2577baf): its latest run completed after the thread was last visited. A
 * thread never visited shows none. The server's read marker is the only
 * one; T3 Code's browser-local fallback is for servers without it.
 */
export function hasUnseenCompletion(
  thread: Pick<OrchestrationV2ThreadShell, "latestRunCompletedAt" | "lastVisitedAt">,
): boolean {
  if (thread.latestRunCompletedAt === null || thread.lastVisitedAt === null) return false;
  const completedAt = Date.parse(thread.latestRunCompletedAt);
  if (Number.isNaN(completedAt)) return false;
  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

/**
 * A double-click sends two clicks before `dblclick`, the second with
 * `detail` 2; that one must not run a row's single-click navigation, or
 * double-click-to-rename would navigate too (T3 Code's
 * `isTrailingDoubleClick`). Keyboard activations have `detail` 0.
 */
export function isTrailingDoubleClick(detail: number): boolean {
  return detail > 1;
}

/**
 * The sidebar's thread search results (T3 Code's `searchSidebarThreads`):
 * threads whose title holds the query, then those the server matched by a
 * message (`messageMatchIds`), each in the order given. Titles are matched
 * here; only messages go to the server.
 */
export function searchSidebarThreads<T extends { readonly id: string; readonly title: string }>(
  threads: ReadonlyArray<T>,
  query: string,
  messageMatchIds: ReadonlySet<string>,
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const titleMatches: T[] = [];
  const messageMatches: T[] = [];
  for (const thread of threads) {
    if (thread.title.toLowerCase().includes(needle)) titleMatches.push(thread);
    else if (messageMatchIds.has(thread.id)) messageMatches.push(thread);
  }
  return [...titleMatches, ...messageMatches];
}

/** The highlighted result after an arrow key, wrapping at either end. */
export function moveSearchHighlight(index: number, count: number, direction: "up" | "down") {
  return direction === "down" ? (index + 1) % count : (index - 1 + count) % count;
}

interface SearchHighlightPart {
  readonly text: string;
  readonly highlighted: boolean;
  readonly start: number;
}

// The server's `LIKE` folds ASCII letters only, so the highlight does the same.
const foldAsciiCase = (value: string) =>
  value.replace(/[A-Z]/g, (character) => character.toLowerCase());

/**
 * A snippet cut into the parts that match the query and those that do not
 * (T3 Code's `HighlightedSearchText` in `ThreadSearchMatch.tsx`).
 */
export function splitSearchHighlights(text: string, query: string): SearchHighlightPart[] {
  const needle = foldAsciiCase(query.trim());
  if (needle.length === 0) return [{ text, highlighted: false, start: 0 }];
  const folded = foldAsciiCase(text);
  const parts: SearchHighlightPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const at = folded.indexOf(needle, cursor);
    if (at === -1) {
      parts.push({ text: text.slice(cursor), highlighted: false, start: cursor });
      break;
    }
    if (at > cursor)
      parts.push({ text: text.slice(cursor, at), highlighted: false, start: cursor });
    parts.push({ text: text.slice(at, at + needle.length), highlighted: true, start: at });
    cursor = at + needle.length;
  }
  return parts;
}

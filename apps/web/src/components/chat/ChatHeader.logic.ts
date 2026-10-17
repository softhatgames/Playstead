/**
 * What an inline rename does with the typed title (T3 Code's
 * `resolveRenameCommit` in `apps/web/src/components/chat/ChatHeader.tsx` at
 * 2577baf): the title without surrounding spaces is sent, an empty one is
 * refused, and an unchanged one sends nothing. The header and the sidebar
 * row share it.
 */
export function resolveRenameCommit(input: {
  readonly title: string;
  readonly originalTitle: string;
}): { action: "commit"; title: string } | { action: "reject-empty" } | { action: "noop" } {
  const trimmed = input.title.trim();
  if (trimmed.length === 0) return { action: "reject-empty" };
  if (trimmed === input.originalTitle) return { action: "noop" };
  return { action: "commit", title: trimmed };
}

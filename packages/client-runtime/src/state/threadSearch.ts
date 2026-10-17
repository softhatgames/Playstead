/**
 * Rank title matches ahead of message matches, preserving the caller's order
 * within each group. The caller supplies active threads in its scope, including
 * folded shelves. Shared by sidebar and palette (T3 Code Sidebar.logic.ts, 2577baf).
 */
export function searchThreads<T extends { readonly id: string; readonly title: string }>(
  threads: ReadonlyArray<T>,
  query: string,
  messageThreadIds: ReadonlySet<string> = new Set(),
): ReadonlyArray<T> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const titles = threads.filter((thread) => thread.title.toLowerCase().includes(needle));
  const titleIds = new Set(titles.map((thread) => thread.id));
  return [
    ...titles,
    ...threads.filter((thread) => !titleIds.has(thread.id) && messageThreadIds.has(thread.id)),
  ];
}

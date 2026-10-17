import type { OrchestrationThreadSearchMatch } from "@playstead/contracts/threadSearch";

import { splitSearchHighlights } from "./Sidebar.logic.ts";

/**
 * The message a thread search matched, under the thread's title: who said
 * it, then its snippet with the query in bold (T3 Code's
 * `ThreadSearchMatchExcerpt` in `apps/web/src/components/ThreadSearchMatch.tsx`
 * at 2577baf). The command palette's Threads group can show it too.
 */
export function ThreadSearchMatchExcerpt(props: {
  readonly match: Pick<OrchestrationThreadSearchMatch, "source" | "snippet">;
  readonly query: string;
}) {
  const isUser = props.match.source === "user";
  return (
    <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
      <span
        className={
          isUser ? "text-sky-700 dark:text-sky-400" : "text-emerald-700 dark:text-emerald-400"
        }
      >
        {isUser ? "You:" : "Agent:"}
      </span>{" "}
      {splitSearchHighlights(props.match.snippet, props.query).map((part) =>
        part.highlighted ? (
          <mark
            key={part.start}
            className="bg-transparent font-semibold text-neutral-900 dark:text-neutral-100"
          >
            {part.text}
          </mark>
        ) : (
          <span key={part.start}>{part.text}</span>
        ),
      )}
    </span>
  );
}

import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2ThreadShell,
} from "@playstead/contracts/orchestrationV2";
import { useCallback, useRef, useState } from "react";

import { renameThread } from "../../hooks/useThreadActions.ts";
import { failureToast, warningToast } from "../../toast.ts";
import { resolveRenameCommit } from "../chat/ChatHeader.logic.ts";
import { hasUnseenCompletion } from "../Sidebar.logic.ts";

/**
 * What both sidebars' thread rows share (T3 Code's `SidebarThreadRow` in
 * `Sidebar.tsx` and `LegacySidebar.tsx` at 2577baf): the status before the
 * title, and renaming in place.
 */

/** Working while the thread's run is, or **Completed** (the unseen-completion dot) until it is viewed. */
export function ThreadStatusIndicator({
  thread,
}: {
  readonly thread: Pick<
    OrchestrationV2ThreadShell,
    "status" | "latestRunCompletedAt" | "lastVisitedAt"
  >;
}) {
  const working = thread.status !== "idle" && ACTIVE_RUN_STATUSES.has(thread.status);
  if (working) {
    return (
      <span
        role="img"
        aria-label="Working"
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-sky-500"
      />
    );
  }
  if (!hasUnseenCompletion(thread)) return null;
  return (
    <span
      role="img"
      aria-label="Completed"
      title="Completed"
      className="size-1.5 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-300/90"
    />
  );
}

/**
 * A row's rename in place: `start` shows the field, Enter or leaving it
 * keeps the new title, Escape the old one, and an empty title is refused.
 */
export function useThreadRename(thread: Pick<OrchestrationV2ThreadShell, "id" | "title">) {
  const [renamingTitle, setRenamingTitle] = useState<string | null>(null);
  const committedRef = useRef(false);
  const start = useCallback(() => {
    committedRef.current = false;
    setRenamingTitle(thread.title);
  }, [thread.title]);

  const commit = (typed: string) => {
    setRenamingTitle(null);
    const resolution = resolveRenameCommit({ title: typed, originalTitle: thread.title });
    if (resolution.action === "reject-empty") {
      warningToast("Thread title cannot be empty");
      return;
    }
    if (resolution.action === "noop") return;
    renameThread(thread.id, resolution.title).catch((error: unknown) =>
      failureToast("Failed to rename thread", error),
    );
  };

  const input =
    renamingTitle === null ? null : (
      <input
        autoFocus
        aria-label="Thread title"
        value={renamingTitle}
        onChange={(event) => setRenamingTitle(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            committedRef.current = true;
            commit(event.currentTarget.value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            committedRef.current = true;
            setRenamingTitle(null);
          }
        }}
        onBlur={(event) => {
          if (committedRef.current) return;
          commit(event.currentTarget.value);
        }}
        className="min-w-0 flex-1 truncate rounded border border-neutral-400 bg-transparent px-0.5 text-sm outline-none dark:border-neutral-500"
      />
    );

  return { start, input, isRenaming: renamingTitle !== null };
}

import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { isMacPlatform } from "@playstead/shared/keybindings";
import { type MouseEvent, useCallback, useRef } from "react";

import { renameThread } from "../../hooks/useThreadActions.ts";
import {
  clearThreadSelection,
  rangeSelectThreadsTo,
  readThreadSelection,
  setThreadSelectionAnchor,
  toggleThreadSelection,
} from "../../threadSelectionStore.ts";
import {
  openProject,
  readThreadRenameDraft,
  setThreadRenameDraft,
  useThreadRenameDraft,
} from "../../uiState.ts";
import { resolveRenameCommit } from "../chat/ChatHeader.logic.ts";
import {
  isTrailingDoubleClick,
  threadStatusLabel,
  type ThreadStatusLabel,
} from "../Sidebar.logic.ts";
import { failureToast, warningToast } from "../ui/toast.tsx";

/**
 * What both sidebars' thread rows share (T3 Code's `SidebarThreadRow` in
 * `Sidebar.tsx` and `LegacySidebar.tsx` at 2577baf): the status before the
 * title, the title, renaming in place, and what clicks on the row do.
 */

/** Mod-click on a Mac is Command, elsewhere Control (T3 Code's `isModClick`). */
const isModClick = (event: Pick<MouseEvent, "metaKey" | "ctrlKey">) =>
  isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;

/**
 * The row link's mouse handlers. Mod-click adds the thread to the selection
 * or takes it out, shift-click selects the run from the anchor, and a plain
 * click opens it, clearing the selection (the trailing click of a
 * double-click does nothing). Double-click renames. Right-click on a
 * selected row opens the bulk menu, otherwise the thread's own menu.
 */
export function sidebarThreadLinkHandlers(input: {
  readonly thread: Pick<OrchestrationV2ThreadShell, "id" | "projectId">;
  /** The rows in the order shown, for a shift-click's range. */
  readonly orderedIds: () => ReadonlyArray<string>;
  readonly startRename: () => void;
  readonly openMenu: (position: { x: number; y: number }) => void;
  readonly onBulkMenu: (position: { x: number; y: number }) => void;
}) {
  const { thread } = input;
  return {
    onClick: (event: MouseEvent) => {
      if (isModClick(event)) {
        event.preventDefault();
        toggleThreadSelection(thread.id);
        return;
      }
      if (event.shiftKey) {
        event.preventDefault();
        rangeSelectThreadsTo(thread.id, input.orderedIds());
        return;
      }
      if (isTrailingDoubleClick(event.detail)) {
        event.preventDefault();
        return;
      }
      clearThreadSelection();
      setThreadSelectionAnchor(thread.id);
      openProject(thread.projectId);
    },
    onDoubleClick: (event: MouseEvent) => {
      event.preventDefault();
      input.startRename();
    },
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      const position = { x: event.clientX, y: event.clientY };
      if (readThreadSelection().selectedThreadIds.has(thread.id)) {
        input.onBulkMenu(position);
        return;
      }
      clearThreadSelection();
      input.openMenu(position);
    },
  };
}

/** The row's title, dimmed while a provider writes a new one (T3 Code's `opacity-55`). */
export function SidebarThreadTitle({
  thread,
}: {
  readonly thread: Pick<OrchestrationV2ThreadShell, "title" | "titleRegeneration">;
}) {
  const regenerating = thread.titleRegeneration !== null;
  return (
    <span
      className={`truncate${regenerating ? " opacity-55" : ""}`}
      title={thread.title}
      aria-busy={regenerating || undefined}
    >
      {thread.title}
    </span>
  );
}

/** The dot each status shows (T3 Code's `dotClass`). */
const STATUS_DOT_CLASS: Record<ThreadStatusLabel, string> = {
  Working: "animate-pulse bg-sky-500",
  Completed: "bg-emerald-500 dark:bg-emerald-300/90",
};

/** A status as its dot, named for screen readers and on hover. */
export function ThreadStatusDot({ status }: { readonly status: ThreadStatusLabel }) {
  return (
    <span
      role="img"
      aria-label={status}
      title={status}
      className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[status]}`}
    />
  );
}

/** Working while the thread's run is, or **Completed** (the unseen-completion dot) until it is viewed. */
export function ThreadStatusIndicator({
  thread,
}: {
  readonly thread: Pick<
    OrchestrationV2ThreadShell,
    "status" | "latestRunCompletedAt" | "lastVisitedAt"
  >;
}) {
  const status = threadStatusLabel(thread);
  return status === null ? null : <ThreadStatusDot status={status} />;
}

/**
 * A row's rename in place: `start` shows the field, Enter or leaving it
 * keeps the new title, Escape the old one, and an empty title is refused.
 */
export function useThreadRename(thread: Pick<OrchestrationV2ThreadShell, "id" | "title">) {
  const draft = useThreadRenameDraft();
  const renamingTitle = draft?.threadId === thread.id ? draft.title : null;
  const setRenamingTitle = useCallback(
    (title: string | null) =>
      setThreadRenameDraft(title === null ? null : { threadId: thread.id, title }),
    [thread.id],
  );
  const committedRef = useRef(false);
  const start = useCallback(() => {
    committedRef.current = false;
    setRenamingTitle(thread.title);
  }, [thread.title, setRenamingTitle]);

  const commit = (typed: string) => {
    if (readThreadRenameDraft()?.threadId !== thread.id) return;
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

/** A row's jump key, such as `⌘3`, shown while the jump modifier is held (T3 Code's `JumpHintBadge`). */
export function JumpHintBadge({ label }: { readonly label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 right-1.5 z-10 inline-flex h-5 -translate-y-1/2 items-center rounded-full border border-neutral-300 bg-white/95 px-1.5 font-mono text-[10px] font-medium text-neutral-900 shadow-sm dark:border-neutral-700 dark:bg-neutral-950/95 dark:text-neutral-100"
    >
      {label}
    </span>
  );
}

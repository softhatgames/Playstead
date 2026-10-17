import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { desktopBridge } from "../../env.ts";
import { useThreadActionMenu } from "../../hooks/useThreadActionMenu.ts";
import { renameThread, type ThreadActionTarget } from "../../hooks/useThreadActions.ts";
import { failureToast, warningToast } from "../../toast.ts";
import { ChevronDownIcon } from "../icons.tsx";
import { isTrailingDoubleClick } from "../Sidebar.logic.ts";
import { resolveRenameCommit } from "./ChatHeader.logic.ts";

/**
 * How long a click on the title waits before opening the menu, so a
 * double-click can rename instead. Only the desktop app's native menu needs
 * it: that menu takes the mouse while open (T3 Code's
 * `TITLE_MENU_OPEN_DELAY_MS`).
 */
const TITLE_MENU_OPEN_DELAY_MS = 500;

/**
 * The thread view's header (T3 Code's `apps/web/src/components/chat/ChatHeader.tsx`
 * at 2577baf, without its breadcrumb's project button and parent thread).
 * Clicking the title opens the thread menu, as does right-clicking the
 * header; double-clicking the title, or **Rename thread** in the menu,
 * renames it in place. Enter or leaving the field keeps the new title,
 * Escape keeps the old one, and an empty title is refused.
 */
export function ChatHeader(props: {
  readonly title: string;
  readonly projectTitle: string | undefined;
  /** The thread, once it exists; a draft's header has no menu and cannot be renamed. */
  readonly thread: ThreadActionTarget | null;
}) {
  const { title, thread } = props;
  const [renamingTitle, setRenamingTitle] = useState<string | null>(null);
  const renameCommittedRef = useRef(false);
  const threadId = thread?.id;
  useEffect(() => setRenamingTitle(null), [threadId]);

  const startRename = useCallback(() => {
    if (thread === null) return;
    renameCommittedRef.current = false;
    setRenamingTitle(thread.title);
  }, [thread]);

  const commitRename = (typed: string) => {
    setRenamingTitle(null);
    if (thread === null) return;
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

  const { openMenu, closeMenu } = useThreadActionMenu(thread, { onStartRename: startRename });
  const titleButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingMenu = useCallback(() => {
    if (menuTimerRef.current === null) return;
    clearTimeout(menuTimerRef.current);
    menuTimerRef.current = null;
  }, []);
  useEffect(() => cancelPendingMenu, [cancelPendingMenu, threadId]);

  const openMenuNow = () => {
    cancelPendingMenu();
    const rect = titleButtonRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    openMenu({ x: rect.left, y: rect.bottom + 4 });
  };

  const onTitleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (isTrailingDoubleClick(event.detail)) return;
    const onChevron = (event.target as HTMLElement).closest("[data-thread-title-chevron]") !== null;
    if (event.detail === 0 || onChevron || desktopBridge === undefined) {
      openMenuNow();
      return;
    }
    cancelPendingMenu();
    menuTimerRef.current = setTimeout(() => {
      menuTimerRef.current = null;
      openMenuNow();
    }, TITLE_MENU_OPEN_DELAY_MS);
  };

  const onTitleDoubleClick = (event: ReactMouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((event.target as HTMLElement).closest("[data-thread-title-chevron]") !== null) return;
    cancelPendingMenu();
    closeMenu();
    startRename();
  };

  const onRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      renameCommittedRef.current = true;
      commitRename(event.currentTarget.value);
    } else if (event.key === "Escape") {
      renameCommittedRef.current = true;
      setRenamingTitle(null);
    }
  };

  return (
    <header
      onContextMenu={(event) => {
        if (thread === null || renamingTitle !== null) return;
        cancelPendingMenu();
        event.preventDefault();
        openMenu({ x: event.clientX, y: event.clientY });
      }}
      className="flex items-center gap-2 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800"
    >
      {renamingTitle !== null ? (
        <input
          autoFocus
          aria-label="Thread title"
          defaultValue={renamingTitle}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={onRenameKeyDown}
          onBlur={(event) => {
            if (renameCommittedRef.current) return;
            commitRename(event.currentTarget.value);
          }}
          className="min-w-0 flex-1 rounded-sm bg-transparent px-1 text-sm font-medium outline-none ring-1 ring-neutral-300 ring-inset focus:ring-neutral-500 dark:ring-neutral-700 dark:focus:ring-neutral-400"
        />
      ) : thread === null ? (
        <h1 className="truncate text-sm font-medium">{title}</h1>
      ) : (
        <button
          ref={titleButtonRef}
          type="button"
          aria-label={`Thread actions for ${title}`}
          aria-haspopup="menu"
          title={title}
          onClick={onTitleClick}
          onDoubleClick={onTitleDoubleClick}
          onBlur={cancelPendingMenu}
          className="group/thread-title inline-flex min-w-0 items-center gap-1 rounded-sm text-left"
        >
          <h1 className="truncate text-sm font-medium">{title}</h1>
          <span
            data-thread-title-chevron
            className="shrink-0 text-neutral-500 opacity-0 transition-opacity group-hover/thread-title:opacity-100 group-focus-visible/thread-title:opacity-100 dark:text-neutral-400"
          >
            <ChevronDownIcon className="size-3.5" />
          </span>
        </button>
      )}
      {props.projectTitle === undefined ? null : (
        <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
          {props.projectTitle}
        </span>
      )}
    </header>
  );
}

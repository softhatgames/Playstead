import {
  type KeyboardEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { onOpenCommandPalette } from "../commandPaletteBus.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { useAddProjectBrowse } from "../hooks/useAddProjectBrowse.ts";
import { useCommandPaletteItems } from "../hooks/useCommandPaletteItems.ts";
import { copyThreadReference } from "../hooks/useThreadShortcuts.ts";
import { keybindings, resolveShortcutCommand, threadJumpIndexFromCommand } from "../keybindings.ts";
import {
  buildCommandPaletteRows,
  buildRootGroups,
  type CommandPaletteEntry,
  type CommandPaletteView,
  filterCommandPaletteGroups,
  findHighlightedCommandPaletteItem,
  getCommandPaletteInputPlaceholder,
  getCommandPaletteMode,
  reduceCommandPaletteUiState,
} from "./CommandPalette.logic.ts";
import { CommandPaletteContent } from "./CommandPaletteContent.tsx";
import {
  COMMAND_PALETTE_ICON_CLASS,
  COMMAND_PALETTE_LISTBOX_ID,
  CommandPaletteResults,
  commandPaletteOptionId,
} from "./CommandPaletteResults.tsx";
import { ArrowLeftIcon, FolderPlusIcon } from "./icons.tsx";
import { failureToast } from "./ui/toast.tsx";

/** Where Add project starts browsing (T3 Code's default without a base folder setting). */
const ADD_PROJECT_INITIAL_QUERY = "~/";

const fileManagerName = (platform: string) =>
  /mac/i.test(platform) ? "Finder" : /win/i.test(platform) ? "File Explorer" : "Files";

const isPrimaryModifierPressed = (event: KeyboardEvent) =>
  /mac/i.test(navigator.platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;

/**
 * T3 Code's command palette (`apps/web/src/components/CommandPalette.tsx`
 * at 2577baf; its frame is `CommandPaletteContent.tsx` and its list
 * `CommandPaletteResults.tsx`),
 * in its command mode. `mod+k` opens and closes it; the bus opens it
 * straight into **Add project** or **New thread in…**. T3 Code's file and
 * project-content search modes wait for version control and project
 * search.
 */
export function CommandPalette() {
  const [state, dispatch] = useReducer(reduceCommandPaletteUiState, {
    open: false,
    openIntent: null,
  });

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (resolveShortcutCommand(event, keybindings) !== "commandPalette.toggle") return;
      event.preventDefault();
      event.stopPropagation();
      dispatch({ _tag: "Toggle" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(
    () =>
      onOpenCommandPalette((detail) =>
        dispatch(
          detail.open === "new-thread-in"
            ? { _tag: "OpenNewThreadIn" }
            : detail.open === "add-project"
              ? { _tag: "OpenAddProject" }
              : { _tag: "SetOpen", open: true },
        ),
      ),
    [],
  );

  const close = useCallback(() => dispatch({ _tag: "SetOpen", open: false }), []);
  const clearOpenIntent = useCallback(() => dispatch({ _tag: "ClearOpenIntent" }), []);
  if (!state.open) return null;
  return (
    <OpenCommandPalette
      openIntent={state.openIntent}
      close={close}
      clearOpenIntent={clearOpenIntent}
    />
  );
}

function OpenCommandPalette(props: {
  readonly openIntent: "add-project" | "new-thread-in" | null;
  readonly close: () => void;
  readonly clearOpenIntent: () => void;
}) {
  const { openIntent, close, clearOpenIntent } = props;
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const isActionsOnly = deferredQuery.startsWith(">");
  const [viewStack, setViewStack] = useState<ReadonlyArray<CommandPaletteView>>([]);
  const currentView = viewStack.at(-1) ?? null;
  // Null follows the list's first row, as T3 Code's auto-highlight does.
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const state = usePrimaryConnectionState();

  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, [viewStack.length]);

  const pushView = useCallback((view: CommandPaletteView) => {
    setViewStack((views) => [...views, view]);
    setHighlighted(null);
    setQuery(view.initialQuery ?? "");
  }, []);
  const popView = () => {
    setViewStack((views) => views.slice(0, -1));
    setHighlighted(null);
    setQuery("");
  };
  const openAddProjectFlow = useCallback(
    () => pushView({ addon: "add-project", groups: [], initialQuery: ADD_PROJECT_INITIAL_QUERY }),
    [pushView],
  );

  const items = useCommandPaletteItems({
    query: deferredQuery,
    atRoot: currentView === null,
    openAddProjectFlow,
  });
  const { routeThread, newThreadInGroups, hasNewThreadProjects } = items;

  useLayoutEffect(() => {
    if (openIntent !== "add-project") return;
    clearOpenIntent();
    setViewStack([]);
    openAddProjectFlow();
  }, [openIntent, clearOpenIntent, openAddProjectFlow]);

  useLayoutEffect(() => {
    if (openIntent !== "new-thread-in" || !hasNewThreadProjects) return;
    clearOpenIntent();
    setViewStack([]);
    pushView({ addon: "new-thread", groups: newThreadInGroups });
  }, [openIntent, clearOpenIntent, hasNewThreadProjects, newThreadInGroups, pushView]);

  const filteredGroups = filterCommandPaletteGroups({
    activeGroups:
      currentView?.groups ??
      buildRootGroups({
        actionItems: items.actionItems,
        recentThreadItems: items.recentThreadItems,
      }),
    query: deferredQuery,
    isInSubmenu: currentView !== null,
    projectSearchItems: items.projectSearchItems,
    settingsSearchItems: items.settingsSearchItems,
    threadSearchItems: items.allThreadItems,
  });

  const browse = useAddProjectBrowse({
    query,
    connected: state?.phase === "connected",
    platform: state?.config?.environment.platform.os ?? "",
    projects: items.projects,
    browseTo: (nextQuery) => {
      setQuery(nextQuery);
      setHighlighted(null);
      inputRef.current?.focus();
    },
    close,
  });
  const { isBrowsing, busy, resolvedPath, addProject } = browse;

  const displayedGroups = isBrowsing ? browse.browseGroups : filteredGroups;
  const { rows, itemValues } = buildCommandPaletteRows(displayedGroups);
  const autoHighlightsFirstRow = !isBrowsing;
  const activeValue =
    highlighted !== null && itemValues.includes(highlighted)
      ? highlighted
      : autoHighlightsFirstRow
        ? (itemValues[0] ?? null)
        : null;
  const activeIndex = activeValue === null ? -1 : itemValues.indexOf(activeValue);
  const hasHighlightedBrowseItem = isBrowsing && activeValue !== null;

  useEffect(() => {
    if (activeIndex >= 0) {
      document
        .getElementById(commandPaletteOptionId(activeIndex))
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const mode = getCommandPaletteMode({ inView: currentView !== null, isBrowsing });
  const isSubmenu = mode === "submenu" || mode === "submenu-browse";

  const executeItem = (item: CommandPaletteEntry) => {
    if (item.disabled) return;
    if (item.kind === "submenu") {
      pushView({ addon: "new-thread", groups: item.groups });
      return;
    }
    if (!item.keepOpen) close();
    item.run().catch((cause: unknown) => failureToast("Unable to run command", cause));
  };

  const handleQueryChange = (next: string) => {
    setQuery(next);
    setHighlighted(null);
    browse.clearError();
    if (next === "" && currentView?.initialQuery !== undefined) popView();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter that confirms an IME composition is part of typing.
    if (event.nativeEvent.isComposing) return;
    const command = resolveShortcutCommand(event.nativeEvent, keybindings);
    if (threadJumpIndexFromCommand(command) !== null) {
      event.preventDefault();
      event.stopPropagation();
      const item = displayedGroups
        .flatMap((group) => group.items)
        .find((candidate) => candidate.shortcutCommand === command);
      if (item !== undefined) executeItem(item);
      return;
    }
    if (command === "thread.copyReference") {
      event.preventDefault();
      event.stopPropagation();
      if (routeThread === undefined) return;
      close();
      void copyThreadReference(routeThread.id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // The layout's Escape would clear the thread selection too.
      event.stopPropagation();
      close();
      return;
    }
    if (
      isBrowsing &&
      event.key === "Enter" &&
      (!hasHighlightedBrowseItem || isPrimaryModifierPressed(event))
    ) {
      event.preventDefault();
      void addProject(resolvedPath);
      return;
    }
    if (event.key === "Backspace" && query === "" && isSubmenu) {
      event.preventDefault();
      popView();
      return;
    }
    if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (itemValues.length === 0) return;
      const down = event.key === "ArrowDown";
      const next =
        highlighted === null || activeIndex === -1
          ? down
            ? 0
            : itemValues.length - 1
          : (activeIndex + (down ? 1 : -1) + itemValues.length) % itemValues.length;
      setHighlighted(itemValues[next] ?? null);
      return;
    }
    if (event.key === "Enter") {
      const item = findHighlightedCommandPaletteItem(displayedGroups, activeValue);
      if (item === null) return;
      event.preventDefault();
      event.stopPropagation();
      executeItem(item);
    }
  };

  const { error } = browse;
  const browseStatus = browse.status;
  const threadById = items.threadById;
  const pickFolder = browse.pickFolder;
  const emptyMessage = browse.willCreateFolder
    ? "Press Enter to create this folder and add it as a project."
    : isBrowsing
      ? undefined
      : items.isSearchingMessages
        ? "Searching thread messages…"
        : isActionsOnly
          ? "No matching actions."
          : "No matching commands, projects, or threads.";
  const footerActionLabel = !isBrowsing || hasHighlightedBrowseItem ? "Select" : undefined;
  const modLabel = /mac/i.test(navigator.platform) ? "⌘" : "Ctrl";

  return (
    <CommandPaletteContent
      onClose={close}
      inputRef={inputRef}
      inputProps={{
        value: query,
        onChange: (event) => handleQueryChange(event.target.value),
        onKeyDown,
        placeholder: getCommandPaletteInputPlaceholder(mode),
        "aria-label": isBrowsing ? "Project path" : "Search the command palette",
        role: "combobox",
        "aria-expanded": true,
        "aria-controls": COMMAND_PALETTE_LISTBOX_ID,
        "aria-activedescendant": activeIndex >= 0 ? commandPaletteOptionId(activeIndex) : undefined,
      }}
      inputLeading={
        isSubmenu ? (
          <button
            type="button"
            aria-label="Back"
            onClick={popView}
            className="text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            <ArrowLeftIcon className="size-4" />
          </button>
        ) : isBrowsing ? (
          <FolderPlusIcon className={COMMAND_PALETTE_ICON_CLASS} />
        ) : null
      }
      inputAccessory={
        isBrowsing ? (
          <button
            type="button"
            disabled={busy || resolvedPath.length === 0}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void addProject(resolvedPath)}
            className="flex shrink-0 items-center gap-2 rounded-md border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            <span>{busy ? "Adding" : "Add"}</span>
            <kbd className="opacity-70">
              {hasHighlightedBrowseItem ? `${modLabel} Enter` : "Enter"}
            </kbd>
          </button>
        ) : null
      }
      status={
        error !== undefined ? (
          <span className="text-red-600 dark:text-red-400">{error}</span>
        ) : (
          browseStatus
        )
      }
      {...(footerActionLabel === undefined ? {} : { footerActionLabel })}
      showBackHint={isSubmenu}
      footerTrailing={
        isBrowsing && browse.canPickFolder ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void pickFolder()}
            className="rounded-md px-2 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-900"
          >
            {`Open in ${fileManagerName(navigator.platform)}`}
          </button>
        ) : null
      }
    >
      <CommandPaletteResults
        rows={rows}
        activeValue={activeValue}
        emptyMessage={emptyMessage}
        threadById={threadById}
        onHighlight={(item) => setHighlighted(item.value)}
        onExecute={executeItem}
      />
    </CommandPaletteContent>
  );
}

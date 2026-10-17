import {
  appendBrowsePathSegment,
  filterFilesystemBrowseEntries,
  getBrowseUpPath,
  getFilesystemBrowsePath,
  resolveAddProjectPath,
} from "@playstead/client-runtime/state/filesystem";
import { CommandId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { FilesystemBrowseResult } from "@playstead/contracts/filesystem";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  type KeyboardEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { useClientSettings } from "../clientSettings.ts";
import { onOpenCommandPalette } from "../commandPaletteBus.ts";
import { requestPrimary, usePrimaryConnectionState } from "../connection/runtime.ts";
import { useThreadSearch } from "../connection/useThreadSearch.ts";
import { desktopBridge } from "../env.ts";
import { useHandleNewThread } from "../hooks/useHandleNewThread.ts";
import { useScratchProject } from "../hooks/useScratchProject.ts";
import { copyThreadReference } from "../hooks/useThreadShortcuts.ts";
import { newId } from "../ids.ts";
import { keybindings, resolveShortcutCommand, threadJumpIndexFromCommand } from "../keybindings.ts";
import { sortThreads } from "@playstead/client-runtime/state/threadSort";
import { failureToast } from "./ui/toast.tsx";
import { openProject } from "../uiState.ts";
import { planAddProject } from "./addProject.logic.ts";
import {
  buildCommandPaletteRows,
  buildProjectActionItems,
  buildRootGroups,
  buildThreadActionItems,
  type CommandPaletteActionItem,
  type CommandPaletteEntry,
  type CommandPaletteGroup,
  type CommandPaletteView,
  enumerateCommandPaletteItems,
  filterCommandPaletteGroups,
  findHighlightedCommandPaletteItem,
  getCommandPaletteInputPlaceholder,
  getCommandPaletteMode,
  RECENT_THREAD_LIMIT,
  reduceCommandPaletteUiState,
  withNoProjectItem,
} from "./CommandPalette.logic.ts";
import { CommandPaletteContent } from "./CommandPaletteContent.tsx";
import {
  COMMAND_PALETTE_ICON_CLASS,
  COMMAND_PALETTE_LISTBOX_ID,
  CommandPaletteResults,
  commandPaletteOptionId,
} from "./CommandPaletteResults.tsx";
import { ArrowLeftIcon, FolderPlusIcon } from "./icons.tsx";
import { SETTINGS_SECTION_LABELS, searchSettings } from "./settings/settingsSearch.ts";

/** Where Add project starts browsing (T3 Code's default without a base folder setting). */
const ADD_PROJECT_INITIAL_QUERY = "~/";

const fileManagerName = (platform: string) =>
  /mac/i.test(platform) ? "Finder" : /win/i.test(platform) ? "File Explorer" : "Files";

const isPrimaryModifierPressed = (event: KeyboardEvent) =>
  /mac/i.test(navigator.platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message.length > 0 ? error.message : "An error occurred.";

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

interface BrowseState {
  readonly directoryPath: string;
  readonly result?: FilesystemBrowseResult;
  readonly error?: string;
}

function OpenCommandPalette(props: {
  readonly openIntent: "add-project" | "new-thread-in" | null;
  readonly close: () => void;
  readonly clearOpenIntent: () => void;
}) {
  const { openIntent, close, clearOpenIntent } = props;
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const isActionsOnly = deferredQuery.startsWith(">");
  const [viewStack, setViewStack] = useState<ReadonlyArray<CommandPaletteView>>([]);
  const currentView = viewStack.at(-1) ?? null;
  // Null follows the list's first row, as T3 Code's auto-highlight does.
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const state = usePrimaryConnectionState();
  const connected = state?.phase === "connected";
  const platform = state?.config?.environment.platform.os ?? "";
  const projects = useMemo(() => state?.shell?.projects ?? [], [state?.shell?.projects]);
  const threads = useMemo(() => state?.shell?.threads ?? [], [state?.shell?.threads]);
  const settings = useClientSettings();
  const { threadId: routeThreadId } = useParams({ strict: false });
  const routeThread = threads.find((thread) => thread.id === routeThreadId);
  const { groups: projectGroups, contextProjectId, startInProject } = useHandleNewThread();
  const { scratchWorkspaceRoot, startScratchThread } = useScratchProject();

  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, [viewStack.length]);

  // Projects in the sidebar's order, each named as its group is.
  const orderedProjects = useMemo(() => {
    const byId = new Map(projects.map((project) => [project.id as string, project]));
    return projectGroups.flatMap((group) =>
      group.isScratch
        ? []
        : group.projectIds.flatMap((id) => {
            const project = byId.get(id);
            return project === undefined ? [] : [{ ...project, title: group.displayName }];
          }),
    );
  }, [projectGroups, projects]);
  const projectTitleById = useMemo(
    () => new Map(projects.map((project) => [project.id as string, project.title])),
    [projects],
  );
  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id as string, thread])),
    [threads],
  );

  const threadSearchQuery = currentView === null && !isActionsOnly ? deferredQuery : "";
  const threadSearch = useThreadSearch(threadSearchQuery);
  const matchByThreadId = useMemo(
    () => new Map(threadSearch.matches.map((match) => [match.threadId as string, match])),
    [threadSearch.matches],
  );

  const openThread = useCallback(
    async (thread: { readonly id: string; readonly projectId: string }) => {
      openProject(thread.projectId);
      await navigate({ to: "/threads/$threadId", params: { threadId: ThreadId.make(thread.id) } });
    },
    [navigate],
  );

  const allThreadItems = useMemo(
    () =>
      buildThreadActionItems({
        threads,
        ...(routeThreadId === undefined ? {} : { activeThreadId: routeThreadId }),
        projectTitleById,
        sortOrder: settings.sidebarThreadSortOrder,
        now: Date.now(),
        getContentMatch: (thread) => {
          const match = matchByThreadId.get(thread.id);
          return match === undefined
            ? undefined
            : { source: match.source, snippet: match.snippet, query: threadSearch.query };
        },
        runThread: openThread,
      }),
    [
      threads,
      routeThreadId,
      projectTitleById,
      settings.sidebarThreadSortOrder,
      matchByThreadId,
      threadSearch.query,
      openThread,
    ],
  );
  const recentThreadItems = allThreadItems.slice(0, RECENT_THREAD_LIMIT);

  // A project from search opens its latest thread, or a new one (T3 Code's `openProjectFromSearch`).
  const projectSearchItems = useMemo(
    () =>
      buildProjectActionItems({
        projects: orderedProjects,
        valuePrefix: "project",
        icon: "project",
        runProject: async (project) => {
          const latest = sortThreads(
            threads.filter((thread) => thread.projectId === project.id),
            settings.sidebarThreadSortOrder,
          )[0];
          if (latest !== undefined) await openThread(latest);
          else await startInProject(project.id);
        },
      }),
    [orderedProjects, threads, settings.sidebarThreadSortOrder, openThread, startInProject],
  );

  const contextIsScratch =
    projectGroups.find(
      (group) => contextProjectId !== undefined && group.projectIds.includes(contextProjectId),
    )?.isScratch ?? false;
  const projectThreadItems = useMemo(() => {
    const projectItems = enumerateCommandPaletteItems(
      buildProjectActionItems({
        projects: orderedProjects,
        valuePrefix: "new-thread-in",
        icon: "project",
        runProject: async (project) => {
          await startInProject(project.id);
        },
      }),
    );
    return scratchWorkspaceRoot === null
      ? projectItems
      : withNoProjectItem(projectItems, { contextIsScratch, run: startScratchThread });
  }, [orderedProjects, startInProject, scratchWorkspaceRoot, contextIsScratch, startScratchThread]);
  const newThreadInGroups: ReadonlyArray<CommandPaletteGroup> = useMemo(
    () => [{ value: "projects", label: "Projects", items: projectThreadItems }],
    [projectThreadItems],
  );

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

  useLayoutEffect(() => {
    if (openIntent !== "add-project") return;
    clearOpenIntent();
    setViewStack([]);
    openAddProjectFlow();
  }, [openIntent, clearOpenIntent, openAddProjectFlow]);

  useLayoutEffect(() => {
    if (openIntent !== "new-thread-in" || projectThreadItems.length === 0) return;
    clearOpenIntent();
    setViewStack([]);
    pushView({ addon: "new-thread", groups: newThreadInGroups });
  }, [openIntent, clearOpenIntent, projectThreadItems.length, newThreadInGroups, pushView]);

  const actionItems: CommandPaletteEntry[] = [];
  if (projects.length > 0) {
    const contextTitle =
      contextProjectId === undefined ? undefined : projectTitleById.get(contextProjectId);
    if (contextProjectId !== undefined && contextTitle !== undefined) {
      actionItems.push({
        kind: "action",
        value: "action:new-thread",
        searchTerms: ["new thread", "chat", "create", "draft"],
        title: "New thread in",
        titleEmphasis: contextTitle,
        icon: "new-thread",
        shortcutCommand: "chat.newLocal",
        run: async () => {
          await startInProject(contextProjectId);
        },
      });
    }
    actionItems.push({
      kind: "submenu",
      value: "action:new-thread-in",
      searchTerms: ["new thread", "project", "pick", "choose", "select"],
      title: "New thread in...",
      icon: "new-thread",
      groups: newThreadInGroups,
    });
  }
  if (scratchWorkspaceRoot !== null) {
    actionItems.push({
      kind: "action",
      value: "action:new-thread-without-project",
      searchTerms: ["new thread", "no project", "without project", "none", "chat"],
      title: "New thread without a project",
      icon: "no-project",
      shortcutCommand: "chat.newWithoutProject",
      run: startScratchThread,
    });
  }
  if (routeThread !== undefined) {
    actionItems.push({
      kind: "action",
      value: "action:copy-thread-reference",
      searchTerms: ["copy", "thread id", "reference"],
      title: "Copy thread ID",
      description: routeThread.id,
      icon: "copy",
      shortcutCommand: "thread.copyReference",
      run: () => copyThreadReference(routeThread.id),
    });
  }
  actionItems.push({
    kind: "action",
    value: "action:add-project",
    searchTerms: ["add project", "folder", "directory", "browse"],
    title: "Add project",
    icon: "add-project",
    keepOpen: true,
    run: async () => openAddProjectFlow(),
  });
  actionItems.push({
    kind: "action",
    value: "action:settings",
    searchTerms: ["settings", "preferences", "configuration", "keybindings"],
    title: "Open settings",
    icon: "settings",
    run: async () => {
      await navigate({ to: "/settings" });
    },
  });

  const settingsSearchItems: CommandPaletteActionItem[] = searchSettings(deferredQuery).map(
    (item) => ({
      kind: "action",
      value: `setting:${item.id}`,
      searchTerms: [item.title, SETTINGS_SECTION_LABELS[item.to], ...(item.searchTerms ?? [])],
      title: item.title,
      description: `Settings · ${SETTINGS_SECTION_LABELS[item.to]}`,
      ...(item.secondary ? { secondary: true } : {}),
      icon: "settings",
      run: async () => {
        await navigate({
          to: item.to,
          hash: item.targetId ?? item.id,
          replace: pathname === item.to,
        });
      },
    }),
  );

  const filteredGroups = filterCommandPaletteGroups({
    activeGroups: currentView?.groups ?? buildRootGroups({ actionItems, recentThreadItems }),
    query: deferredQuery,
    isInSubmenu: currentView !== null,
    projectSearchItems,
    settingsSearchItems,
    threadSearchItems: allThreadItems,
  });

  // Add project: a typed path browses the server's folders.
  const [browse, setBrowse] = useState<BrowseState | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // State lags a render behind, so a repeated Enter could start a second create.
  const submittingRef = useRef(false);
  const browsePath = getFilesystemBrowsePath(query, platform);
  const isBrowsing = connected && browsePath.isBrowsing;
  const directoryPath = browsePath.directoryPath;

  useEffect(() => {
    if (!isBrowsing) return;
    let current = true;
    setBrowse((previous) =>
      previous?.directoryPath === directoryPath ? previous : { directoryPath },
    );
    requestPrimary((client) => client["filesystem.browse"]({ partialPath: directoryPath })).then(
      (result) => {
        if (current) setBrowse({ directoryPath, result });
      },
      (cause: unknown) => {
        if (current) setBrowse({ directoryPath, error: errorMessage(cause) });
      },
    );
    return () => {
      current = false;
    };
  }, [isBrowsing, directoryPath]);

  const listed = browse?.directoryPath === directoryPath ? browse : undefined;
  const { visibleEntries, exactEntry } = filterFilesystemBrowseEntries(
    listed?.result?.entries ?? [],
    browsePath.filterQuery,
  );
  const upPath = browsePath.canBrowseUp ? getBrowseUpPath(directoryPath) : null;
  const willCreateFolder =
    listed?.result !== undefined &&
    browsePath.filterQuery.length > 0 &&
    exactEntry === null &&
    visibleEntries.length === 0;
  const resolvedPath = resolveAddProjectPath(query, listed?.result?.parentPath, exactEntry);

  const browseTo = (nextQuery: string) => {
    setQuery(nextQuery);
    setHighlighted(null);
    setError(undefined);
    inputRef.current?.focus();
  };
  // T3 Code's `buildBrowseGroups`.
  const browseGroups: ReadonlyArray<CommandPaletteGroup> = [
    {
      value: "directories",
      label: "",
      items: [
        ...(upPath === null
          ? []
          : [
              {
                kind: "action" as const,
                value: "browse:up",
                searchTerms: [".."],
                title: "..",
                icon: "folder-up" as const,
                keepOpen: true,
                run: async () => browseTo(upPath),
              },
            ]),
        ...visibleEntries.map((entry) => ({
          kind: "action" as const,
          value: `browse:${entry.fullPath}`,
          searchTerms: [entry.name],
          title: entry.name,
          icon: "folder" as const,
          keepOpen: true,
          run: async () => browseTo(appendBrowsePathSegment(query, entry.name)),
        })),
      ],
    },
  ];

  const addProject = async (rawPath: string) => {
    if (submittingRef.current) return;
    const plan = planAddProject({ rawPath, platform, projects });
    switch (plan.kind) {
      case "none":
        return;
      case "error":
        setError(plan.message);
        return;
      case "open":
        openProject(plan.projectId);
        close();
        return;
      case "create":
        break;
    }
    submittingRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const project = await requestPrimary((client) =>
        client["projects.mutate"]({
          type: "project.create",
          commandId: CommandId.make(`command:${newId()}`),
          projectId: ProjectId.make(`project:${newId()}`),
          title: plan.title,
          workspaceRoot: plan.workspaceRoot,
          createWorkspaceRootIfMissing: true,
        }),
      );
      openProject(project.id);
      close();
    } catch (cause) {
      // The folder already has a project under another spelling: open that one.
      if (
        typeof cause === "object" &&
        cause !== null &&
        "_tag" in cause &&
        cause._tag === "ProjectConflictError" &&
        "conflictingProjectId" in cause &&
        typeof cause.conflictingProjectId === "string"
      ) {
        openProject(cause.conflictingProjectId);
        close();
        return;
      }
      setError(`Failed to add project: ${errorMessage(cause)}`);
      setBusy(false);
    } finally {
      submittingRef.current = false;
    }
  };

  const pickFolder = async () => {
    if (desktopBridge === undefined || busy) return;
    const picked = await desktopBridge.pickFolder().catch(() => null);
    if (picked !== null) await addProject(picked);
  };

  const displayedGroups = isBrowsing ? browseGroups : filteredGroups;
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
    setError(undefined);
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

  const browseStatus = !isBrowsing
    ? undefined
    : listed?.error !== undefined
      ? listed.error
      : listed?.result === undefined
        ? "Loading folders..."
        : undefined;
  const emptyMessage = willCreateFolder
    ? "Press Enter to create this folder and add it as a project."
    : isBrowsing
      ? undefined
      : threadSearch.isPending
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
        isBrowsing && desktopBridge !== undefined ? (
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

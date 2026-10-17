import { sortThreads } from "@playstead/client-runtime/state/threadSort";
import { ThreadId } from "@playstead/contracts/baseSchemas";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { useClientSettings } from "../clientSettings.ts";
import {
  buildProjectActionItems,
  buildThreadActionItems,
  type CommandPaletteActionItem,
  type CommandPaletteEntry,
  type CommandPaletteGroup,
  enumerateCommandPaletteItems,
  RECENT_THREAD_LIMIT,
  withNoProjectItem,
} from "../components/CommandPalette.logic.ts";
import { SETTINGS_SECTION_LABELS, searchSettings } from "../components/settings/settingsSearch.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { useThreadSearch } from "../connection/useThreadSearch.ts";
import { openProject } from "../uiState.ts";
import { useHandleNewThread } from "./useHandleNewThread.ts";
import { useScratchProject } from "./useScratchProject.ts";
import { copyThreadReference } from "./useThreadShortcuts.ts";

/**
 * What the command palette offers (T3 Code's item building in
 * `apps/web/src/components/CommandPalette.tsx` at 2577baf): the root's
 * Actions and Recent Threads, **New thread in…**'s projects, and what a
 * query searches: projects, settings and threads, threads also by their
 * messages once the query has waited (`useThreadSearch`).
 */
export function useCommandPaletteItems(input: {
  /** The query as the list shows it (deferred while typing). */
  readonly query: string;
  /** Whether the palette is at its root, where a query searches threads' messages. */
  readonly atRoot: boolean;
  readonly openAddProjectFlow: () => void;
}) {
  const { query, atRoot, openAddProjectFlow } = input;
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const state = usePrimaryConnectionState();
  const projects = useMemo(() => state?.shell?.projects ?? [], [state?.shell?.projects]);
  const threads = useMemo(() => state?.shell?.threads ?? [], [state?.shell?.threads]);
  const settings = useClientSettings();
  const { threadId: routeThreadId } = useParams({ strict: false });
  const routeThread = threads.find((thread) => thread.id === routeThreadId);
  const { groups: projectGroups, contextProjectId, startInProject } = useHandleNewThread();
  const { scratchWorkspaceRoot, startScratchThread } = useScratchProject();

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

  const threadSearch = useThreadSearch(atRoot && !query.startsWith(">") ? query : "");
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

  const settingsSearchItems: CommandPaletteActionItem[] = searchSettings(query).map((item) => ({
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
  }));

  return {
    projects,
    routeThread,
    threadById,
    isSearchingMessages: threadSearch.isPending,
    actionItems,
    recentThreadItems,
    allThreadItems,
    projectSearchItems,
    settingsSearchItems,
    newThreadInGroups,
    hasNewThreadProjects: projectThreadItems.length > 0,
  };
}

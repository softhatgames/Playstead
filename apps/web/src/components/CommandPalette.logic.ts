import type { OrchestrationThreadSearchMatch } from "@playstead/contracts/threadSearch";
import {
  type KeybindingCommand,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@playstead/shared/keybindings";

import {
  sortThreads,
  type ThreadSortInput,
  type ThreadSortOrder,
  threadSortTimestamp,
} from "../threadSort.ts";

/**
 * The command palette's logic (T3 Code's `apps/web/src/components/CommandPalette.logic.ts`
 * at 2577baf): its items and groups, how a query filters and ranks them,
 * and the modes it is in. Items carry an icon name and plain text so this
 * stays apart from React; `CommandPalette.tsx` draws them.
 */

export const RECENT_THREAD_LIMIT = 12;

/** T3 Code's lucide icons for each kind of item. */
export type CommandPaletteIcon =
  | "new-thread"
  | "add-project"
  | "settings"
  | "copy"
  | "project"
  | "thread"
  | "folder"
  | "folder-up";

export interface CommandPaletteThreadContentMatch {
  readonly source: OrchestrationThreadSearchMatch["source"];
  readonly snippet: string;
  readonly query: string;
}

export interface CommandPaletteItem {
  readonly kind: "action" | "submenu";
  readonly value: string;
  /** What a query is matched against; the first is the title. */
  readonly searchTerms: ReadonlyArray<string>;
  readonly title: string;
  /** Shown in bold after the title, as T3 Code's "New thread in **project**". */
  readonly titleEmphasis?: string;
  readonly description?: string;
  readonly threadContentMatch?: CommandPaletteThreadContentMatch;
  /** The thread a row stands for, so it can show the thread's status. */
  readonly threadId?: string;
  readonly timestamp?: string;
  /** Ties between equally good title matches go to the most recent. */
  readonly searchRecency?: number;
  readonly icon: CommandPaletteIcon;
  readonly disabled?: boolean;
  readonly shortcutCommand?: KeybindingCommand;
  /** Listed after the other matches. */
  readonly secondary?: boolean;
}

export interface CommandPaletteActionItem extends CommandPaletteItem {
  readonly kind: "action";
  /** The palette stays open after running it. */
  readonly keepOpen?: boolean;
  readonly run: () => Promise<void>;
}

export interface CommandPaletteSubmenuItem extends CommandPaletteItem {
  readonly kind: "submenu";
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
}

export type CommandPaletteEntry = CommandPaletteActionItem | CommandPaletteSubmenuItem;

export interface CommandPaletteGroup {
  readonly value: string;
  readonly label: string;
  readonly items: ReadonlyArray<CommandPaletteEntry>;
}

/**
 * A level the palette went into: a submenu's groups, or Add project's folder
 * browsing, which starts at `initialQuery`. Clearing the query leaves a view
 * that has one.
 */
export interface CommandPaletteView {
  readonly addon: "new-thread" | "add-project";
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export type CommandPaletteOpenIntent = "add-project" | "new-thread-in";

export interface CommandPaletteUiState {
  readonly open: boolean;
  /** What the palette was opened for, until it has gone there. */
  readonly openIntent: CommandPaletteOpenIntent | null;
}

export type CommandPaletteUiAction =
  | { readonly _tag: "SetOpen"; readonly open: boolean }
  | { readonly _tag: "Toggle" }
  | { readonly _tag: "OpenAddProject" }
  | { readonly _tag: "OpenNewThreadIn" }
  | { readonly _tag: "ClearOpenIntent" };

/** T3 Code's `reduceCommandPaletteUiState`, without the file and content search modes. */
export function reduceCommandPaletteUiState(
  state: CommandPaletteUiState,
  action: CommandPaletteUiAction,
): CommandPaletteUiState {
  switch (action._tag) {
    case "SetOpen":
      return action.open
        ? { open: true, openIntent: state.openIntent }
        : { open: false, openIntent: null };
    case "Toggle":
      return state.open ? { open: false, openIntent: null } : { open: true, openIntent: null };
    case "OpenAddProject":
      return { open: true, openIntent: "add-project" };
    case "OpenNewThreadIn":
      return { open: true, openIntent: "new-thread-in" };
    case "ClearOpenIntent":
      return state.openIntent === null ? state : { ...state, openIntent: null };
  }
}

/** Lower case, without accents or repeated spaces (T3 Code's `normalizeSearchText`). */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export type CommandPaletteRow =
  | {
      readonly kind: "label";
      readonly key: string;
      readonly label: string;
      readonly first: boolean;
    }
  | {
      readonly kind: "item";
      readonly key: string;
      readonly item: CommandPaletteEntry;
      /** Its place among the items that can run, or null when it is disabled. */
      readonly itemIndex: number | null;
    };

/** The rows drawn, headings included, and the values the arrow keys move through. */
export function buildCommandPaletteRows(groups: ReadonlyArray<CommandPaletteGroup>) {
  const rows: CommandPaletteRow[] = [];
  const itemValues: string[] = [];
  for (const group of groups) {
    if (group.label) {
      rows.push({
        kind: "label",
        key: `group:${group.value}`,
        label: group.label,
        first: rows.length === 0,
      });
    }
    for (const item of group.items) {
      const itemIndex = item.disabled ? null : itemValues.length;
      if (itemIndex !== null) itemValues.push(item.value);
      rows.push({ kind: "item", key: `${group.value}:${item.value}`, item, itemIndex });
    }
  }
  return { rows, itemValues };
}

export function findHighlightedCommandPaletteItem(
  groups: ReadonlyArray<CommandPaletteGroup>,
  highlightedItemValue: string | null,
): CommandPaletteEntry | null {
  if (highlightedItemValue === null) return null;
  for (const group of groups) {
    for (const item of group.items) {
      if (item.value === highlightedItemValue && !item.disabled) return item;
    }
  }
  return null;
}

/** Gives the first nine items `mod+1` to `mod+9`, as **New thread in…** shows them. */
export function enumerateCommandPaletteItems(
  items: ReadonlyArray<CommandPaletteActionItem>,
): CommandPaletteActionItem[] {
  return items.map((item, index) => {
    const shortcutCommand = THREAD_JUMP_KEYBINDING_COMMANDS[index];
    if (shortcutCommand !== undefined) return { ...item, shortcutCommand };
    const { shortcutCommand: _dropped, ...rest } = item;
    return rest;
  });
}

export interface CommandPaletteProject {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

export function buildProjectActionItems<P extends CommandPaletteProject>(input: {
  readonly projects: ReadonlyArray<P>;
  readonly valuePrefix: string;
  readonly icon: CommandPaletteIcon;
  readonly runProject: (project: P) => Promise<void>;
}): CommandPaletteActionItem[] {
  return input.projects.map((project) => ({
    kind: "action",
    value: `${input.valuePrefix}:${project.id}`,
    searchTerms: [project.title, project.workspaceRoot],
    title: project.title,
    description: project.workspaceRoot,
    icon: input.icon,
    run: () => input.runProject(project),
  }));
}

/** `just now`, `5m ago`, `3h ago`, `2d ago` (T3 Code's `formatRelativeTimeLabel`). */
export function formatRelativeTimeLabel(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export type CommandPaletteThread = ThreadSortInput & Readonly<{ projectId: string; title: string }>;

/**
 * A row per thread, newest first by the sidebar's thread order: its project
 * (and "Current thread" for the one in view) under the title, its age, and
 * the message a search matched. Searchable by title, project, that message
 * and the thread's id. The shell holds no archived threads, so none need
 * leaving out (T3 Code's `buildThreadActionItems`).
 */
export function buildThreadActionItems<T extends CommandPaletteThread>(input: {
  readonly threads: ReadonlyArray<T>;
  readonly activeThreadId?: string;
  readonly projectTitleById: ReadonlyMap<string, string>;
  readonly sortOrder: ThreadSortOrder;
  readonly now: number;
  readonly getContentMatch?: (thread: T) => CommandPaletteThreadContentMatch | undefined;
  readonly runThread: (thread: T) => Promise<void>;
  readonly limit?: number;
}): CommandPaletteActionItem[] {
  const sorted = sortThreads(input.threads, input.sortOrder);
  const visible = input.limit === undefined ? sorted : sorted.slice(0, input.limit);
  return visible.map((thread) => {
    const projectTitle = input.projectTitleById.get(thread.projectId);
    const contentMatch = input.getContentMatch?.(thread);
    const description = [
      ...(projectTitle === undefined ? [] : [projectTitle]),
      ...(thread.id === input.activeThreadId ? ["Current thread"] : []),
    ].join(" · ");
    return {
      kind: "action",
      value: `thread:${thread.id}`,
      searchTerms: [thread.title, projectTitle ?? "", contentMatch?.snippet ?? "", thread.id],
      title: thread.title,
      description,
      threadId: thread.id,
      timestamp: formatRelativeTimeLabel(
        thread.latestRunRequestedAt ?? thread.updatedAt,
        input.now,
      ),
      searchRecency: threadSortTimestamp(thread, "updated_at"),
      icon: "thread",
      ...(contentMatch === undefined ? {} : { threadContentMatch: contentMatch }),
      run: () => input.runThread(thread),
    };
  });
}

function rankSearchFieldMatch(
  field: string,
  normalizedQuery: string,
  queryTokens: ReadonlyArray<string>,
): number {
  const normalizedField = normalizeSearchText(field);
  if (
    normalizedField.length === 0 ||
    !queryTokens.every((token) => normalizedField.includes(token))
  ) {
    return Number.NEGATIVE_INFINITY;
  }
  if (normalizedField === normalizedQuery) return 3;
  if (normalizedField.startsWith(normalizedQuery)) return 2;
  if (normalizedField.includes(normalizedQuery)) return 1;
  return 0;
}

/**
 * How well an item matches: by the first search term holding every word,
 * earlier terms ranking higher. A thread's title match ranks the same
 * whatever its kind (unless exact), so recency decides between them.
 */
function rankCommandPaletteItemMatch(
  item: CommandPaletteEntry,
  normalizedQuery: string,
  queryTokens: ReadonlyArray<string>,
): number {
  const terms = item.searchTerms.filter((term) => term.length > 0);
  for (const [index, field] of terms.entries()) {
    const fieldRank = rankSearchFieldMatch(field, normalizedQuery, queryTokens);
    if (fieldRank === Number.NEGATIVE_INFINITY) continue;
    if (index === 0 && item.searchRecency !== undefined) return 1_000 + Number(fieldRank === 3);
    return 1_000 - index * 100 + fieldRank;
  }
  return 0;
}

/**
 * The groups a query shows (T3 Code's `filterCommandPaletteGroups`). Nothing
 * typed shows the view's groups. At the root a query drops Recent Threads
 * and adds the Projects, Settings and Threads groups after the actions; `>`
 * keeps the actions only; a submenu searches its own items. An item shows
 * when its terms hold every word of the query, best match first.
 */
export function filterCommandPaletteGroups(input: {
  readonly activeGroups: ReadonlyArray<CommandPaletteGroup>;
  readonly query: string;
  readonly isInSubmenu: boolean;
  readonly projectSearchItems: ReadonlyArray<CommandPaletteActionItem>;
  readonly settingsSearchItems: ReadonlyArray<CommandPaletteActionItem>;
  readonly threadSearchItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const isActionsFilter = input.query.startsWith(">");
  const normalizedQuery = normalizeSearchText(isActionsFilter ? input.query.slice(1) : input.query);
  const baseGroups = isActionsFilter
    ? input.activeGroups.filter((group) => group.value === "actions")
    : input.isInSubmenu || normalizedQuery.length === 0
      ? [...input.activeGroups]
      : input.activeGroups.filter((group) => group.value !== "recent-threads");
  if (normalizedQuery.length === 0) return baseGroups;
  const queryTokens = normalizedQuery.split(" ");

  const searchableGroups = [...baseGroups];
  if (!input.isInSubmenu && !isActionsFilter) {
    const searchGroups: ReadonlyArray<CommandPaletteGroup> = [
      { value: "projects-search", label: "Projects", items: input.projectSearchItems },
      { value: "settings-search", label: "Settings", items: input.settingsSearchItems },
      { value: "threads-search", label: "Threads", items: input.threadSearchItems },
    ];
    searchableGroups.push(...searchGroups.filter((group) => group.items.length > 0));
  }

  return searchableGroups.flatMap((group) => {
    const items = group.items
      .flatMap((item, index) => {
        const haystack = normalizeSearchText(item.searchTerms.join(" "));
        if (!queryTokens.every((token) => haystack.includes(token))) return [];
        return [
          { item, index, rank: rankCommandPaletteItemMatch(item, normalizedQuery, queryTokens) },
        ];
      })
      .toSorted(
        (left, right) =>
          Number(left.item.secondary ?? false) - Number(right.item.secondary ?? false) ||
          right.rank - left.rank ||
          (right.item.searchRecency ?? 0) - (left.item.searchRecency ?? 0) ||
          left.index - right.index,
      )
      .map((entry) => entry.item);
    return items.length === 0 ? [] : [{ value: group.value, label: group.label, items }];
  });
}

export function buildRootGroups(input: {
  readonly actionItems: ReadonlyArray<CommandPaletteEntry>;
  readonly recentThreadItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  return [
    ...(input.actionItems.length === 0
      ? []
      : [{ value: "actions", label: "Actions", items: input.actionItems }]),
    ...(input.recentThreadItems.length === 0
      ? []
      : [{ value: "recent-threads", label: "Recent Threads", items: input.recentThreadItems }]),
  ];
}

export type CommandPaletteMode = "root" | "root-browse" | "submenu" | "submenu-browse";

export function getCommandPaletteMode(input: {
  readonly inView: boolean;
  readonly isBrowsing: boolean;
}): CommandPaletteMode {
  if (input.inView) return input.isBrowsing ? "submenu-browse" : "submenu";
  return input.isBrowsing ? "root-browse" : "root";
}

export function getCommandPaletteInputPlaceholder(mode: CommandPaletteMode): string {
  switch (mode) {
    case "root":
      return "Search commands, projects, and threads...";
    case "root-browse":
      return "Enter project path (e.g. ~/projects/my-app)";
    case "submenu":
      return "Search...";
    case "submenu-browse":
      return "Enter path (e.g. ~/projects/my-app)";
  }
}

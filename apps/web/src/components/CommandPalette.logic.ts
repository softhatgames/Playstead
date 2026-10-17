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
} from "@playstead/client-runtime/state/threadSort";

/**
 * What the command palette lists and how a query narrows it, kept apart from
 * React: items carry an icon name and plain text, and `CommandPalette.tsx`
 * draws them. The behaviour is T3 Code's palette at 2577baf
 * (`apps/web/src/components/CommandPalette.logic.ts`).
 */

export const RECENT_THREAD_LIMIT = 12;

/** One icon per kind of item; `CommandPalette.tsx` maps each to a lucide icon. */
export type CommandPaletteIcon =
  | "new-thread"
  | "no-project"
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
  /** The texts a query looks in, most important first; the first is the title. */
  readonly searchTerms: ReadonlyArray<string>;
  readonly title: string;
  /** Bold text after the title, as in "New thread in **project**". */
  readonly titleEmphasis?: string;
  readonly description?: string;
  readonly threadContentMatch?: CommandPaletteThreadContentMatch;
  /** The thread a row stands for, so it can show the thread's status. */
  readonly threadId?: string;
  readonly timestamp?: string;
  /**
   * When the thread was last active. A row with one is a thread: its title
   * matches rank alike, so the most recent comes first.
   */
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

const CLOSED: CommandPaletteUiState = { open: false, openIntent: null };
const openFor = (openIntent: CommandPaletteOpenIntent | null): CommandPaletteUiState => ({
  open: true,
  openIntent,
});

/** Opening and closing. Closing always forgets what the palette was opened for. */
export function reduceCommandPaletteUiState(
  state: CommandPaletteUiState,
  action: CommandPaletteUiAction,
): CommandPaletteUiState {
  if (action._tag === "SetOpen") return action.open ? openFor(state.openIntent) : CLOSED;
  if (action._tag === "Toggle") return state.open ? CLOSED : openFor(null);
  if (action._tag === "OpenAddProject") return openFor("add-project");
  if (action._tag === "OpenNewThreadIn") return openFor("new-thread-in");
  return state.openIntent === null ? state : { ...state, openIntent: null };
}

/** Folds case, accents and runs of white space, so "  ARCHÌVED " reads "archived". */
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
  const itemValues = groups
    .flatMap((group) => group.items)
    .filter((item) => !item.disabled)
    .map((item) => item.value);
  const rows: CommandPaletteRow[] = [];
  let runnable = 0;
  for (const group of groups) {
    const heading: CommandPaletteRow[] = group.label
      ? [
          {
            kind: "label",
            key: `group:${group.value}`,
            label: group.label,
            first: rows.length === 0,
          },
        ]
      : [];
    const items = group.items.map((item): CommandPaletteRow => ({
      kind: "item",
      key: `${group.value}:${item.value}`,
      item,
      itemIndex: item.disabled ? null : runnable++,
    }));
    rows.push(...heading, ...items);
  }
  return { rows, itemValues };
}

/** The item Enter runs: the highlighted one, unless it is disabled or gone. */
export function findHighlightedCommandPaletteItem(
  groups: ReadonlyArray<CommandPaletteGroup>,
  highlightedItemValue: string | null,
): CommandPaletteEntry | null {
  if (highlightedItemValue === null) return null;
  const item = groups
    .flatMap((group) => group.items)
    .find((candidate) => candidate.value === highlightedItemValue && !candidate.disabled);
  return item ?? null;
}

/** Gives the first nine items `mod+1` to `mod+9`, as **New thread in…** shows them. */
export function enumerateCommandPaletteItems(
  items: ReadonlyArray<CommandPaletteActionItem>,
): CommandPaletteActionItem[] {
  return items.map((item, position) => {
    const { shortcutCommand: _previous, ...withoutShortcut } = item;
    const jump = THREAD_JUMP_KEYBINDING_COMMANDS[position];
    return jump === undefined ? withoutShortcut : { ...withoutShortcut, shortcutCommand: jump };
  });
}

/**
 * **New thread in…**'s projects with **No project** among them: first while
 * the thread in view has no project, else second (T3 Code's
 * `projectThreadItems`). It keeps `chat.newWithoutProject` as its shortcut,
 * and the projects keep their jump shortcuts.
 */
export function withNoProjectItem(
  projectItems: ReadonlyArray<CommandPaletteActionItem>,
  input: { readonly contextIsScratch: boolean; readonly run: () => Promise<void> },
): CommandPaletteActionItem[] {
  const noProject: CommandPaletteActionItem = {
    kind: "action",
    value: "new-thread-in:no-project",
    searchTerms: ["No project", "start without a project", "none"],
    title: "No project",
    icon: "no-project",
    shortcutCommand: "chat.newWithoutProject",
    run: input.run,
  };
  const items = [...projectItems];
  items.splice(input.contextIsScratch ? 0 : 1, 0, noProject);
  return items;
}

export interface CommandPaletteProject {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

/** One row per project, found by its name or its folder. */
export function buildProjectActionItems<P extends CommandPaletteProject>(input: {
  readonly projects: ReadonlyArray<P>;
  readonly valuePrefix: string;
  readonly icon: CommandPaletteIcon;
  readonly runProject: (project: P) => Promise<void>;
}): CommandPaletteActionItem[] {
  const { projects, valuePrefix, icon, runProject } = input;
  return projects.map((project): CommandPaletteActionItem => ({
    kind: "action",
    value: `${valuePrefix}:${project.id}`,
    title: project.title,
    description: project.workspaceRoot,
    searchTerms: [project.title, project.workspaceRoot],
    icon,
    run: () => runProject(project),
  }));
}

const MINUTE_MS = 60_000;

/** An age to show beside a thread: `just now`, `5m ago`, `3h ago`, `2d ago`. */
export function formatRelativeTimeLabel(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const minutes = Math.floor((now - at) / MINUTE_MS);
  if (minutes < 1) return "just now";
  const units: ReadonlyArray<readonly [suffix: string, minutes: number]> = [
    ["d", 24 * 60],
    ["h", 60],
    ["m", 1],
  ];
  const [suffix, size] = units.find(([, unit]) => minutes >= unit) ?? ["m", 1];
  return `${Math.floor(minutes / size)}${suffix} ago`;
}

export type CommandPaletteThread = ThreadSortInput & Readonly<{ projectId: string; title: string }>;

/**
 * A row per thread in the sidebar's thread order: its project (and "Current
 * thread" for the one in view) under the title, its age, and the message a
 * search matched. A query finds it by title, project, that message or its id.
 * The shell holds no archived threads, so none need leaving out.
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
  const ordered = sortThreads(input.threads, input.sortOrder).slice(0, input.limit);
  return ordered.map((thread): CommandPaletteActionItem => {
    const projectTitle = input.projectTitleById.get(thread.projectId);
    const isCurrent = thread.id === input.activeThreadId;
    const contentMatch = input.getContentMatch?.(thread);
    const item: CommandPaletteActionItem = {
      kind: "action",
      value: `thread:${thread.id}`,
      title: thread.title,
      description: [projectTitle, isCurrent ? "Current thread" : undefined]
        .filter((part) => part !== undefined)
        .join(" · "),
      searchTerms: [thread.title, projectTitle ?? "", contentMatch?.snippet ?? "", thread.id],
      threadId: thread.id,
      timestamp: formatRelativeTimeLabel(
        thread.latestRunRequestedAt ?? thread.updatedAt,
        input.now,
      ),
      searchRecency: threadSortTimestamp(thread, "updated_at"),
      icon: "thread",
      run: () => input.runThread(thread),
    };
    return contentMatch === undefined ? item : { ...item, threadContentMatch: contentMatch };
  });
}

/** A query as the palette reads it: the whole phrase and its words, folded. */
interface PaletteQuery {
  readonly phrase: string;
  readonly words: ReadonlyArray<string>;
}

/**
 * How an item answers a query. `term` is the first of its search terms
 * that holds every word (lower is better; Infinity when the words are only
 * spread over several terms). `closeness` says how the phrase sits in that
 * term: 3 the whole term, 2 its start, 1 inside it, 0 only word by word.
 */
interface PaletteMatch {
  readonly term: number;
  readonly closeness: number;
}

const holdsEveryWord = (text: string, query: PaletteQuery) =>
  query.words.every((word) => text.includes(word));

function closenessIn(text: string, phrase: string): number {
  if (text === phrase) return 3;
  if (text.startsWith(phrase)) return 2;
  return text.includes(phrase) ? 1 : 0;
}

function matchItem(item: CommandPaletteEntry, query: PaletteQuery): PaletteMatch | null {
  if (!holdsEveryWord(normalizeSearchText(item.searchTerms.join(" ")), query)) return null;
  const terms = item.searchTerms.filter((term) => term.length > 0).map(normalizeSearchText);
  const term = terms.findIndex((text) => holdsEveryWord(text, query));
  if (term === -1) return { term: Number.POSITIVE_INFINITY, closeness: 0 };
  const closeness = closenessIn(terms[term] ?? "", query.phrase);
  // A thread's title match counts the same however close, unless exact,
  // so between threads the most recent decides.
  const isThreadTitle = term === 0 && item.searchRecency !== undefined;
  return { term, closeness: isThreadTitle ? (closeness === 3 ? 1 : 0) : closeness };
}

/** Earlier is better: primary before secondary, then the match, then recency. */
function compareMatches(
  left: { readonly item: CommandPaletteEntry; readonly match: PaletteMatch },
  right: { readonly item: CommandPaletteEntry; readonly match: PaletteMatch },
): number {
  const secondary = (entry: CommandPaletteEntry) => (entry.secondary === true ? 1 : 0);
  return (
    secondary(left.item) - secondary(right.item) ||
    left.match.term - right.match.term ||
    right.match.closeness - left.match.closeness ||
    (right.item.searchRecency ?? 0) - (left.item.searchRecency ?? 0)
  );
}

function narrowGroup(group: CommandPaletteGroup, query: PaletteQuery): CommandPaletteGroup | null {
  const matches = group.items.flatMap((item) => {
    const match = matchItem(item, query);
    return match === null ? [] : [{ item, match }];
  });
  if (matches.length === 0) return null;
  // `toSorted` is stable, so equal matches keep the group's own order.
  return { ...group, items: matches.toSorted(compareMatches).map(({ item }) => item) };
}

/**
 * The groups a query shows. Nothing typed shows the view's groups as they
 * are. At the root, a query drops Recent Threads and adds Projects, Settings
 * and Threads after the actions; a leading `>` keeps only the actions; a
 * submenu searches its own items. An item shows when its search terms hold
 * every word of the query, best match first.
 */
export function filterCommandPaletteGroups(input: {
  readonly activeGroups: ReadonlyArray<CommandPaletteGroup>;
  readonly query: string;
  readonly isInSubmenu: boolean;
  readonly projectSearchItems: ReadonlyArray<CommandPaletteActionItem>;
  readonly settingsSearchItems: ReadonlyArray<CommandPaletteActionItem>;
  readonly threadSearchItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const actionsOnly = input.query.startsWith(">");
  const phrase = normalizeSearchText(actionsOnly ? input.query.slice(1) : input.query);

  if (actionsOnly) {
    const actions = input.activeGroups.filter((group) => group.value === "actions");
    return phrase === "" ? actions : narrowAll(actions, phrase);
  }
  if (phrase === "") return [...input.activeGroups];
  if (input.isInSubmenu) return narrowAll(input.activeGroups, phrase);

  const searched: ReadonlyArray<CommandPaletteGroup> = [
    ...input.activeGroups.filter((group) => group.value !== "recent-threads"),
    { value: "projects-search", label: "Projects", items: input.projectSearchItems },
    { value: "settings-search", label: "Settings", items: input.settingsSearchItems },
    { value: "threads-search", label: "Threads", items: input.threadSearchItems },
  ];
  return narrowAll(searched, phrase);
}

function narrowAll(groups: ReadonlyArray<CommandPaletteGroup>, phrase: string) {
  const query: PaletteQuery = { phrase, words: phrase.split(" ") };
  return groups.flatMap((group) => narrowGroup(group, query) ?? []);
}

/** The root before anything is typed: Actions, then Recent Threads, each when it has items. */
export function buildRootGroups(input: {
  readonly actionItems: ReadonlyArray<CommandPaletteEntry>;
  readonly recentThreadItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const groups: ReadonlyArray<CommandPaletteGroup> = [
    { value: "actions", label: "Actions", items: input.actionItems },
    { value: "recent-threads", label: "Recent Threads", items: input.recentThreadItems },
  ];
  return groups.filter((group) => group.items.length > 0);
}

export type CommandPaletteMode = "root" | "root-browse" | "submenu" | "submenu-browse";

export function getCommandPaletteMode(input: {
  readonly inView: boolean;
  readonly isBrowsing: boolean;
}): CommandPaletteMode {
  const level = input.inView ? "submenu" : "root";
  return input.isBrowsing ? `${level}-browse` : level;
}

const INPUT_PLACEHOLDERS: Readonly<Record<CommandPaletteMode, string>> = {
  root: "Search commands, projects, and threads...",
  "root-browse": "Enter project path (e.g. ~/projects/my-app)",
  submenu: "Search...",
  "submenu-browse": "Enter path (e.g. ~/projects/my-app)",
};

export function getCommandPaletteInputPlaceholder(mode: CommandPaletteMode): string {
  return INPUT_PLACEHOLDERS[mode];
}

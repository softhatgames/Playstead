import { normalizeSearchText } from "../CommandPalette.logic.ts";

/**
 * The settings rows the command palette can find, as T3 Code's palette finds
 * its own (`apps/web/src/components/settings/settingsSearch.ts` at 2577baf).
 * A result opens its page at the row: the element whose id is `targetId`, or
 * else `id`. A ticket that adds a settings row adds its entry here.
 */

export type SettingsPath = "/settings/general" | "/settings/providers" | "/settings/archived";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
  /** Other words people may type for the row, besides its title and page. */
  readonly searchTerms?: ReadonlyArray<string>;
  readonly secondary?: boolean;
}

export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsPath, string>> = {
  "/settings/general": "General",
  "/settings/providers": "Providers",
  "/settings/archived": "Archive",
};

const general = (
  id: string,
  title: string,
  searchTerms: ReadonlyArray<string>,
  targetId?: string,
): SettingsSearchItem => ({
  id,
  title,
  to: "/settings/general",
  searchTerms,
  ...(targetId === undefined ? {} : { targetId }),
});

/** In the order the pages show them, which breaks ties between equal matches. */
const SETTINGS_SEARCH_ITEMS: ReadonlyArray<SettingsSearchItem> = [
  general("default-permissions", "Permissions", [
    "what a new thread's agent may do without asking",
    "supervised, auto-accept edits or full access",
    "approvals runtime mode",
  ]),
  general("working-shelf", "Working section (beta)", [
    "gather running threads in their own section",
    "busy agents inbox sidebar",
  ]),
  general("auto-settle-inactive-threads", "Auto-settle inactive threads", [
    "settle quiet threads automatically after days of inactivity",
    "idle sidebar tidy",
  ]),
  general(
    "days-before-auto-settle",
    "Days of inactivity before auto-settle",
    ["how long a thread stays quiet before it settles", "idle number"],
    "auto-settle-inactive-threads",
  ),
  general("follow-up-behavior", "Follow-up behavior", [
    "sending a message while the agent works",
    "queue it or steer the run",
  ]),
  general("archive-confirmation", "Archive confirmation", [
    "ask before putting a thread away",
    "click twice in the sidebar",
  ]),
  general("delete-confirmation", "Delete confirmation", [
    "ask before removing a thread and its messages for good",
  ]),
  general("text-generation-model", "Text generation model", [
    "the model that writes thread titles",
    "naming threads automatically",
  ]),
  general("legacy-plan-mode", "Plan mode (legacy)", [
    "the older plan button in the composer",
    "planning before building",
  ]),
  general("legacy-sidebar", "Sidebar (legacy)", ["the older project and thread tree", "flat list"]),
  {
    id: "providers",
    title: "Providers",
    to: "/settings/providers",
    searchTerms: ["coding agents Codex Claude", "sign in, sign out, install", "models"],
  },
  {
    id: "archive",
    title: "Archived threads",
    to: "/settings/archived",
    searchTerms: ["unarchive, bring back put-away threads", "by project"],
  },
];

interface FoldedRow {
  readonly title: string;
  /** The title, the page's name and the search terms. */
  readonly texts: ReadonlyArray<string>;
}

interface FoldedQuery {
  readonly phrase: string;
  readonly words: ReadonlyArray<string>;
}

/**
 * Better matches first: the exact title, a title starting with the query,
 * a title holding it, a title holding every word, any text holding the
 * whole query. A row matching none of these, only word by word across its
 * texts, comes last.
 */
const MATCH_TIERS: ReadonlyArray<(row: FoldedRow, query: FoldedQuery) => boolean> = [
  (row, query) => row.title === query.phrase,
  (row, query) => row.title.startsWith(query.phrase),
  (row, query) => row.title.includes(query.phrase),
  (row, query) => query.words.every((word) => row.title.includes(word)),
  (row, query) => row.texts.some((text) => text.includes(query.phrase)),
];

function foldRow(item: SettingsSearchItem): FoldedRow {
  const title = normalizeSearchText(item.title);
  const others = [SETTINGS_SECTION_LABELS[item.to], ...(item.searchTerms ?? [])];
  return { title, texts: [title, ...others.map(normalizeSearchText)] };
}

/** The rows with every word of the query somewhere in their texts, best match first. */
export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
): ReadonlyArray<SettingsSearchItem> {
  const phrase = normalizeSearchText(query);
  if (phrase === "") return [];
  const folded: FoldedQuery = { phrase, words: phrase.split(" ") };

  const found = items.flatMap((item) => {
    const row = foldRow(item);
    const everyWordFound = folded.words.every((word) =>
      row.texts.some((text) => text.includes(word)),
    );
    if (!everyWordFound) return [];
    const tier = MATCH_TIERS.findIndex((matches) => matches(row, folded));
    return [{ item, tier: tier === -1 ? MATCH_TIERS.length : tier }];
  });
  // Secondary rows go last; `toSorted` is stable, so ties keep the pages' order.
  return found
    .toSorted(
      (left, right) =>
        Number(left.item.secondary === true) - Number(right.item.secondary === true) ||
        left.tier - right.tier,
    )
    .map(({ item }) => item);
}

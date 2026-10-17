import { searchThreads } from "@playstead/client-runtime/state/threadSearch";

/** Palette groups, inspired by T3 Code's CommandPalette.logic.ts at 2577baf. */
export type PaletteMode = "root" | "new-thread-in";
export type PaletteAction =
  | "new-thread"
  | "new-thread-in"
  | "add-project"
  | "settings"
  | "copy-reference";
export type SettingsPath = "/settings/general" | "/settings/providers" | "/settings/archived";
export type PaletteTarget =
  | { readonly kind: "action"; readonly action: PaletteAction }
  | { readonly kind: "thread"; readonly threadId: string }
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "settings"; readonly to: SettingsPath };
export interface PaletteItem {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly searchTerms?: string;
  readonly titlePending?: boolean;
  readonly target: PaletteTarget;
}
export interface PaletteGroup {
  readonly label: string;
  readonly items: ReadonlyArray<PaletteItem>;
}
interface PaletteThread {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly createdAt: string;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly titleRegeneration?: object | null;
}
interface PaletteProject {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
}
const settings: ReadonlyArray<PaletteItem> = [
  {
    id: "settings:/settings/general",
    title: "General",
    searchTerms: "settings text generation model titles sidebar working confirm delete auto settle",
    target: { kind: "settings", to: "/settings/general" },
  },
  {
    id: "settings:/settings/providers",
    title: "Providers",
    searchTerms: "settings codex claude authentication models",
    target: { kind: "settings", to: "/settings/providers" },
  },
  {
    id: "settings:/settings/archived",
    title: "Archive",
    searchTerms: "settings archived threads restore unarchive",
    target: { kind: "settings", to: "/settings/archived" },
  },
];

export function buildPaletteGroups(input: {
  readonly mode: PaletteMode;
  readonly sortOrder?: "updated_at" | "created_at";
  readonly query: string;
  readonly actions: ReadonlyArray<PaletteItem>;
  readonly projects: ReadonlyArray<PaletteProject>;
  readonly threads: ReadonlyArray<PaletteThread>;
  readonly messageMatches: ReadonlyArray<{ readonly threadId: string; readonly snippet: string }>;
}): ReadonlyArray<PaletteGroup> {
  const actionsOnly = input.query.startsWith(">");
  const needle = (actionsOnly ? input.query.slice(1) : input.query).trim().toLowerCase();
  const tokens = needle.split(/\s+/);
  const filter = (items: ReadonlyArray<PaletteItem>) =>
    items.filter((item) => {
      const text =
        `${item.title} ${item.searchTerms ?? ""} ${item.description ?? ""}`.toLowerCase();
      return tokens.every((token) => text.includes(token));
    });
  const projects = filter(
    input.projects.map((project): PaletteItem => ({
      id: project.id,
      title: project.title,
      description: project.workspaceRoot,
      target: { kind: "project", projectId: project.id },
    })),
  );
  if (input.mode === "new-thread-in")
    return projects.length ? [{ label: "Projects", items: projects }] : [];
  const actions = filter(input.actions);
  if (actionsOnly) return actions.length ? [{ label: "Actions", items: actions }] : [];
  const threads = input.threads
    .filter((thread) => thread.archivedAt === null && thread.deletedAt === null)
    .toSorted(
      (a, b) =>
        Date.parse(b[input.sortOrder === "created_at" ? "createdAt" : "updatedAt"]) -
          Date.parse(a[input.sortOrder === "created_at" ? "createdAt" : "updatedAt"]) ||
        a.id.localeCompare(b.id),
    );
  const matches = new Map(input.messageMatches.map((match) => [match.threadId, match.snippet]));
  const threadItem = (thread: PaletteThread): PaletteItem => ({
    id: thread.id,
    title: thread.title,
    titlePending: thread.titleRegeneration != null,
    description: [
      input.projects.find((project) => project.id === thread.projectId)?.title,
      needle ? matches.get(thread.id) : undefined,
    ]
      .filter(Boolean)
      .join(" · "),
    target: { kind: "thread", threadId: thread.id },
  });
  const recent = threads.slice(0, 12).map(threadItem);
  if (needle)
    return [
      { label: "Actions", items: actions },
      { label: "Projects", items: projects },
      { label: "Settings", items: filter(settings) },
      {
        label: "Threads",
        items: searchThreads(threads, needle, new Set(matches.keys())).map(threadItem),
      },
    ].filter((group) => group.items.length > 0);
  return [
    ...(actions.length ? [{ label: "Actions", items: actions }] : []),
    ...(recent.length ? [{ label: "Recent Threads", items: recent }] : []),
  ];
}

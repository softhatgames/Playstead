import { isScratchProject } from "@playstead/client-runtime/state/projects";
import { useScratchProject } from "../hooks/useScratchProject.ts";
import { ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { copyTextToClipboard } from "../clipboard.ts";
import { useClientSettings } from "../clientSettings.ts";
import { onOpenCommandPalette, setCommandPaletteOpen } from "../commandPaletteBus.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { createDraft, useDraft } from "../drafts.ts";
import { isElectron } from "../env.ts";
import { useThreadSearch } from "../hooks/useThreadSearch.ts";
import { keybindings, resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings.ts";
import { newThreadDestination, threadNavigationTarget } from "../threadNavigation.ts";
import { clearThreadSelection } from "../threadSelection.ts";
import { failureToast, successToast } from "../toast.ts";
import { openProject, useActiveProjectId } from "../uiState.ts";
import { AddProjectPalette } from "./AddProjectPalette.tsx";
import { buildPaletteGroups, type PaletteItem, type PaletteMode } from "./CommandPalette.logic.ts";

type View = PaletteMode | "add-project";

/** General palette and project picker, studied in T3 Code's CommandPalette.tsx at 2577baf. */
export function CommandPalette() {
  const [view, setView] = useState<View | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
  const state = usePrimaryConnectionState();
  const projects = state?.shell?.projects ?? [];
  const { scratchWorkspaceRoot, startScratchThread } = useScratchProject();
  const threads = state?.shell?.threads ?? [];
  const { threadId, draftId } = useParams({ strict: false });
  const draft = useDraft(draftId ?? "");
  const activeProjectId = useActiveProjectId();
  const settings = useClientSettings();
  const currentThread = threads.find((thread) => thread.id === threadId);
  const newThreadContext = {
    scratchAvailable: scratchWorkspaceRoot !== undefined,
    scratchProjectId: projects.find((project) => isScratchProject(project, scratchWorkspaceRoot))
      ?.id,
    projectIds: projects.map((project) => project.id),
    preferredProjectIds: [draft?.projectId, currentThread?.projectId, activeProjectId],
    legacySidebarEnabled: settings.legacySidebarEnabled,
  };
  const localDestination = newThreadDestination({ ...newThreadContext, local: true });
  const projectId = localDestination.kind === "project" ? localDestination.projectId : undefined;
  const searchQuery = view === "root" && !query.startsWith(">") ? query : "";
  const messages = useThreadSearch(searchQuery);

  const open = (next: View) => {
    if (view === null)
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCommandPaletteOpen(true);
    setView(next);
    setQuery("");
    setActive(0);
  };
  const close = () => {
    setCommandPaletteOpen(false);
    setView(null);
    previousFocus.current?.focus();
  };
  const startThread = (id: string | undefined) => {
    if (id === undefined) {
      open("add-project");
      return;
    }
    close();
    openProject(id);
    clearThreadSelection();
    void navigate({ to: "/draft/$draftId", params: { draftId: createDraft(ProjectId.make(id)) } });
  };
  const startScratch = () => {
    close();
    void startScratchThread();
  };
  const copyReference = () => {
    if (!currentThread) return;
    close();
    void copyTextToClipboard(currentThread.id).then(
      () => successToast("Thread ID copied", currentThread.id),
      (error: unknown) => failureToast("Failed to copy thread ID", error),
    );
  };

  useEffect(() => onOpenCommandPalette((request) => open(request.open)));
  useEffect(() => () => setCommandPaletteOpen(false), []);
  useEffect(() => {
    if (view !== null) input.current?.focus();
  }, [view]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (view === null && document.querySelector('[role="dialog"], dialog[open]')) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: { isDesktop: isElectron },
      });
      if (command === "commandPalette.toggle") {
        event.preventDefault();
        if (view === null) open("root");
        else close();
      } else if (command === "chat.newWithoutProject" && scratchWorkspaceRoot) {
        event.preventDefault();
        startScratch();
      } else if (command === "thread.copyReference" && currentThread) {
        event.preventDefault();
        copyReference();
      } else if (view === null && (command === "chat.new" || command === "chat.newLocal")) {
        event.preventDefault();
        const destination = newThreadDestination({
          ...newThreadContext,
          local: command === "chat.newLocal",
        });
        if (destination.kind === "picker") open("new-thread-in");
        else if (destination.kind === "add-project") open("add-project");
        else if (destination.kind === "scratch") startScratch();
        else startThread(destination.projectId);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  const actions: PaletteItem[] = [
    ...(scratchWorkspaceRoot
      ? [
          {
            id: "action:new-thread-without-project",
            title: "New thread without a project",
            searchTerms: "scratch no project",
            target: { kind: "action", action: "new-thread-without-project" },
          } as const,
        ]
      : []),
    ...(projectId === undefined && !scratchWorkspaceRoot
      ? []
      : [
          {
            id: "action:new-thread",
            title: "New thread",
            description: projects.find((project) => project.id === projectId)?.title ?? "",
            searchTerms: "create chat draft",
            target: { kind: "action", action: "new-thread" },
          } as const,
          {
            id: "action:new-thread-in",
            title: "New thread in…",
            searchTerms: "project pick choose select",
            target: { kind: "action", action: "new-thread-in" },
          } as const,
        ]),
    {
      id: "action:add-project",
      title: "Add project",
      searchTerms: "folder workspace",
      target: { kind: "action", action: "add-project" },
    },
    { id: "action:settings", title: "Settings", target: { kind: "action", action: "settings" } },
    ...(currentThread
      ? [
          {
            id: "action:copy-reference",
            title: "Copy thread reference",
            description: currentThread.id,
            searchTerms: "copy thread id",
            target: { kind: "action", action: "copy-reference" },
          } as const,
        ]
      : []),
  ];
  const groups = buildPaletteGroups({
    mode: view === "new-thread-in" ? view : "root",
    query,
    actions,
    projects,
    threads,
    messageMatches: messages.matches,
    scratchWorkspaceRoot,
    sortOrder: settings.sidebarThreadSortOrder,
  });
  const items = groups.flatMap((group) => group.items);
  const itemOrder = items.map((item) => item.id).join("\0");
  useEffect(() => setActive(0), [itemOrder]);
  useEffect(() => {
    document.getElementById(`palette-item-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, itemOrder]);

  const execute = (item: PaletteItem) => {
    const target = item.target;
    switch (target.kind) {
      case "scratch":
        startScratch();
        return;
      case "thread":
        close();
        clearThreadSelection();
        void navigate({
          to: "/threads/$threadId",
          params: { threadId: ThreadId.make(target.threadId) },
        });
        return;
      case "project":
        startThread(target.projectId);
        return;
      case "settings":
        close();
        void navigate({ to: target.to });
        return;
      case "action":
        switch (target.action) {
          case "new-thread-without-project":
            startScratch();
            return;
          case "new-thread":
            if (projectId === undefined && scratchWorkspaceRoot) startScratch();
            else startThread(projectId);
            return;
          case "new-thread-in":
            open("new-thread-in");
            return;
          case "add-project":
            open("add-project");
            return;
          case "settings":
            close();
            void navigate({ to: "/settings/general" });
            return;
          case "copy-reference":
            copyReference();
            return;
        }
    }
  };
  const shortcut = (item: PaletteItem) => {
    if (item.target.kind !== "action") return null;
    const command =
      item.target.action === "new-thread-without-project"
        ? "chat.newWithoutProject"
        : item.target.action === "new-thread"
          ? "chat.newLocal"
          : item.target.action === "copy-reference"
            ? "thread.copyReference"
            : null;
    return command ? shortcutLabelForCommand(keybindings, command) : null;
  };

  if (view === null) return null;
  if (view === "add-project")
    return <AddProjectPalette onClose={close} onBack={() => open("root")} />;
  let rowIndex = 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-3 pt-[15vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Tab") {
            const focusable = dialog.current?.querySelectorAll<HTMLElement>("input, button");
            if (!focusable?.length) return;
            const next = event.shiftKey
              ? focusable[0] === document.activeElement
              : focusable[focusable.length - 1] === document.activeElement;
            if (next) {
              event.preventDefault();
              (event.shiftKey ? focusable[focusable.length - 1] : focusable[0])?.focus();
            }
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (view === "root") close();
            else open("root");
          }
        }}
      >
        {view === "new-thread-in" ? (
          <button
            type="button"
            onClick={() => open("root")}
            className="px-4 py-2 text-left text-xs text-neutral-500"
          >
            ← New thread in…
          </button>
        ) : null}
        <input
          ref={input}
          role="combobox"
          aria-label={
            view === "root" ? "Search commands, threads, projects and settings" : "Search projects"
          }
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={items[active] ? `palette-item-${active}` : undefined}
          placeholder={view === "root" ? "Search or type > for actions…" : "Search projects…"}
          value={query}
          autoComplete="off"
          spellCheck={false}
          className="border-b border-neutral-200 bg-transparent px-4 py-3 text-sm outline-none dark:border-neutral-800"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            const command = resolveShortcutCommand(event, keybindings, {
              context: { isDesktop: isElectron },
            });
            if (command?.startsWith("thread.jump.")) {
              event.preventDefault();
              event.stopPropagation();
              const jumpItems = items.filter(
                (item) => item.target.kind === (view === "new-thread-in" ? "project" : "thread"),
              );
              const target = threadNavigationTarget(
                jumpItems.map((item) => item.id),
                undefined,
                command,
              );
              const item = jumpItems.find((candidate) => candidate.id === target);
              if (item) execute(item);
              return;
            }
            if (event.key === "Backspace" && query === "" && view !== "root") {
              event.preventDefault();
              open("root");
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (items.length)
                setActive(
                  (index) =>
                    (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length,
                );
            }
            if (event.key === "Enter" && items[active]) {
              event.preventDefault();
              execute(items[active]);
            }
          }}
        />
        <div
          id="palette-results"
          role="listbox"
          aria-label="Commands and search results"
          className="max-h-[55vh] overflow-y-auto py-1"
        >
          {groups.map((group) => (
            <div role="group" aria-label={group.label} key={group.label}>
              <div className="px-4 py-2 text-xs font-medium text-neutral-500">{group.label}</div>
              {group.items.map((item) => {
                const index = rowIndex++;
                return (
                  <div
                    key={item.id}
                    id={`palette-item-${index}`}
                    role="option"
                    aria-selected={active === index}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActive(index)}
                    onClick={() => execute(item)}
                    className={`mx-1 flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm ${active === index ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className={`truncate ${item.titlePending ? "opacity-55" : ""}`}>
                        {item.title}
                      </div>
                      {item.description ? (
                        <div className="truncate text-xs text-neutral-500">{item.description}</div>
                      ) : null}
                    </div>
                    {shortcut(item) ? (
                      <kbd className="shrink-0 text-xs text-neutral-500">{shortcut(item)}</kbd>
                    ) : null}
                    {item.target.kind === "action" && item.target.action === "new-thread-in" ? (
                      <span aria-hidden>›</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
          {items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-neutral-500">No results found.</p>
          ) : null}
        </div>
        {searchQuery.trim().length >= 2 && (messages.isPending || messages.error) ? (
          <div role="status" className="px-4 py-2 text-xs text-neutral-500">
            {messages.error ?? "Searching messages…"}
          </div>
        ) : null}
        <div className="border-t border-neutral-200 px-4 py-2 text-xs text-neutral-500 dark:border-neutral-800">
          ↑↓ Navigate · Enter Select · Esc {view === "root" ? "Close" : "Back"}
        </div>
      </div>
    </div>
  );
}

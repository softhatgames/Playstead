import {
  appendBrowsePathSegment,
  filterFilesystemBrowseEntries,
  getBrowseUpPath,
  getFilesystemBrowsePath,
  resolveAddProjectPath,
} from "@playstead/client-runtime/state/filesystem";
import { CommandId, ProjectId } from "@playstead/contracts/baseSchemas";
import type { FilesystemBrowseResult } from "@playstead/contracts/filesystem";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { onOpenCommandPalette } from "../commandPaletteBus.ts";
import { requestPrimary, usePrimaryConnectionState } from "../connection/runtime.ts";
import { desktopBridge } from "../env.ts";
import { openProject } from "../uiState.ts";
import { planAddProject } from "./addProject.logic.ts";
import { FolderIcon, FolderUpIcon } from "./icons.tsx";

/** Where Add project starts browsing (T3 Code's default without a base folder setting). */
const INITIAL_QUERY = "~/";

const fileManagerName = (platform: string) =>
  /mac/i.test(platform) ? "Finder" : /win/i.test(platform) ? "File Explorer" : "Files";

const isPrimaryModifierPressed = (event: KeyboardEvent) =>
  /mac/i.test(navigator.platform) ? event.metaKey : event.ctrlKey;

/** 16 random bytes as hex, for new command and project ids. */
const newId = () =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message.length > 0 ? error.message : "An error occurred.";

interface BrowseState {
  readonly directoryPath: string;
  readonly result?: FilesystemBrowseResult;
  readonly error?: string;
}

type Row =
  | { readonly kind: "up"; readonly path: string }
  | { readonly kind: "folder"; readonly name: string; readonly fullPath: string };

/**
 * T3 Code's command palette in its add-project mode only
 * (`apps/web/src/components/CommandPalette.tsx` at 2577baf), with the Local
 * folder source: a path field that autocompletes from the server's
 * `filesystem.browse`, and in the desktop app the native folder dialog.
 * Enter adds the typed folder; with a folder highlighted, Enter opens it and
 * Mod+Enter adds.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(INITIAL_QUERY);
  const [highlighted, setHighlighted] = useState(-1);
  const [browse, setBrowse] = useState<BrowseState | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // State lags a render behind, so a repeated Enter could start a second create.
  const submittingRef = useRef(false);

  const state = usePrimaryConnectionState();
  const platform = state?.config?.environment.platform.os ?? "";
  const projects = state?.shell?.projects ?? [];
  const connected = state?.phase === "connected";

  useEffect(
    () =>
      onOpenCommandPalette(() => {
        setQuery(INITIAL_QUERY);
        setHighlighted(-1);
        setError(undefined);
        setOpen(true);
      }),
    [],
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const browsePath = getFilesystemBrowsePath(query, platform);
  const directoryPath = browsePath.directoryPath;

  useEffect(() => {
    if (!open || !connected || !browsePath.isBrowsing) return;
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
  }, [open, connected, browsePath.isBrowsing, directoryPath]);

  const listed = browse?.directoryPath === directoryPath ? browse : undefined;
  const { visibleEntries, exactEntry } = filterFilesystemBrowseEntries(
    listed?.result?.entries ?? [],
    browsePath.filterQuery,
  );
  const upPath = browsePath.canBrowseUp ? getBrowseUpPath(directoryPath) : null;
  const rows: ReadonlyArray<Row> = [
    ...(upPath === null ? [] : [{ kind: "up" as const, path: upPath }]),
    ...visibleEntries.map((entry) => ({ kind: "folder" as const, ...entry })),
  ];
  const willCreateFolder =
    listed?.result !== undefined &&
    browsePath.filterQuery.length > 0 &&
    exactEntry === null &&
    visibleEntries.length === 0;

  const close = () => {
    setOpen(false);
    setBusy(false);
  };

  const browseTo = (nextQuery: string) => {
    setQuery(nextQuery);
    setHighlighted(-1);
    inputRef.current?.focus();
  };

  const activateRow = (row: Row) =>
    browseTo(row.kind === "up" ? row.path : appendBrowsePathSegment(query, row.name));

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

  const resolvedPath = resolveAddProjectPath(query, listed?.result?.parentPath, exactEntry);

  const pickFolder = async () => {
    if (desktopBridge === undefined || busy) return;
    const picked = await desktopBridge.pickFolder().catch(() => null);
    if (picked !== null) await addProject(picked);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      setHighlighted((current) =>
        event.key === "ArrowDown"
          ? Math.min(current + 1, rows.length - 1)
          : Math.max(current - 1, -1),
      );
      return;
    }
    // Enter that confirms an IME composition is part of typing the path.
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const row = rows[highlighted];
    if (row !== undefined && !isPrimaryModifierPressed(event)) {
      activateRow(row);
      return;
    }
    void addProject(resolvedPath);
  };

  if (!open) return null;

  const status = !connected
    ? "Not connected to the server."
    : !browsePath.isBrowsing
      ? undefined
      : listed?.error !== undefined
        ? listed.error
        : listed?.result === undefined
          ? "Loading folders..."
          : willCreateFolder
            ? "Press Enter to create this folder and add it as a project."
            : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[15vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add project"
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlighted(-1);
            setError(undefined);
          }}
          onKeyDown={onKeyDown}
          placeholder="Enter project path (e.g. ~/projects/my-app)"
          aria-label="Project path"
          spellCheck={false}
          autoComplete="off"
          className="border-b border-neutral-200 bg-transparent px-4 py-3 text-sm outline-none dark:border-neutral-800"
        />
        <ul role="listbox" aria-label="Folders" className="max-h-80 overflow-y-auto py-1">
          {rows.map((row, index) => (
            <li
              key={row.kind === "up" ? "browse:up" : `browse:${row.fullPath}`}
              role="option"
              aria-selected={index === highlighted}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => activateRow(row)}
              onMouseMove={() => setHighlighted(index)}
              className={`mx-1 flex cursor-default items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
                index === highlighted ? "bg-neutral-100 dark:bg-neutral-800" : ""
              }`}
            >
              {row.kind === "up" ? (
                <FolderUpIcon className="size-4 text-neutral-500" />
              ) : (
                <FolderIcon className="size-4 text-neutral-500" />
              )}
              <span className="truncate">{row.kind === "up" ? ".." : row.name}</span>
            </li>
          ))}
        </ul>
        {status !== undefined || error !== undefined ? (
          <div role="status" className="px-4 py-2 text-sm text-neutral-500 dark:text-neutral-400">
            {error !== undefined ? (
              <span className="text-red-600 dark:text-red-400">{error}</span>
            ) : (
              status
            )}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 border-t border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
          {desktopBridge !== undefined ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void pickFolder()}
              className="rounded-md px-2 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-900"
            >
              {`Open in ${fileManagerName(navigator.platform)}`}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={busy || !connected || resolvedPath.length === 0}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void addProject(resolvedPath)}
            className="flex items-center gap-2 rounded-md bg-neutral-900 px-3 py-1 text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            <span>{busy ? "Adding" : "Add"}</span>
            <kbd className="text-xs opacity-70">
              {highlighted >= 0
                ? `${/mac/i.test(navigator.platform) ? "⌘" : "Ctrl"} Enter`
                : "Enter"}
            </kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

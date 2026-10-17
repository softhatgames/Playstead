import {
  appendBrowsePathSegment,
  filterFilesystemBrowseEntries,
  getBrowseUpPath,
  getFilesystemBrowsePath,
  resolveAddProjectPath,
} from "@playstead/client-runtime/state/filesystem";
import { CommandId, ProjectId } from "@playstead/contracts/baseSchemas";
import type { FilesystemBrowseResult } from "@playstead/contracts/filesystem";
import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import { useEffect, useRef, useState } from "react";

import { planAddProject } from "../components/addProject.logic.ts";
import type { CommandPaletteGroup } from "../components/CommandPalette.logic.ts";
import { requestPrimary } from "../connection/runtime.ts";
import { desktopBridge } from "../env.ts";
import { newId } from "../ids.ts";
import { openProject } from "../uiState.ts";

interface BrowseState {
  readonly directoryPath: string;
  readonly result?: FilesystemBrowseResult;
  readonly error?: string;
}

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message.length > 0 ? error.message : "An error occurred.";

/**
 * **Add project** in the command palette (T3 Code's browse mode in
 * `apps/web/src/components/CommandPalette.tsx` at 2577baf): a typed path
 * browses the server's folders, Enter adds the folder (making it when it
 * is missing, opening the project when the folder has one), and the
 * desktop app can pick a folder from the system's file manager.
 */
export function useAddProjectBrowse(input: {
  readonly query: string;
  readonly connected: boolean;
  readonly platform: string;
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  /** Moves the query to another folder, from `..` or a listed folder. */
  readonly browseTo: (nextQuery: string) => void;
  readonly close: () => void;
}) {
  const { query, platform, projects, close } = input;
  const [browse, setBrowse] = useState<BrowseState | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // State lags a render behind, so a repeated Enter could start a second create.
  const submittingRef = useRef(false);
  const browsePath = getFilesystemBrowsePath(query, platform);
  const isBrowsing = input.connected && browsePath.isBrowsing;
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
    setError(undefined);
    input.browseTo(nextQuery);
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

  const canPickFolder = desktopBridge !== undefined;
  const pickFolder = async () => {
    if (desktopBridge === undefined || busy) return;
    const picked = await desktopBridge.pickFolder().catch(() => null);
    if (picked !== null) await addProject(picked);
  };

  const status = !isBrowsing
    ? undefined
    : listed?.error !== undefined
      ? listed.error
      : listed?.result === undefined
        ? "Loading folders..."
        : undefined;

  return {
    isBrowsing,
    browseGroups,
    resolvedPath,
    willCreateFolder,
    /** An error to show, or what browsing waits for. */
    status,
    error,
    clearError: () => setError(undefined),
    busy,
    addProject,
    canPickFolder,
    pickFolder,
  };
}

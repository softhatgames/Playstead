import type { ProjectId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import { isScratchProject } from "@playstead/client-runtime/state/projects";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import {
  readPrimaryConnectionState,
  readPrimaryServerSettings,
  requestPrimary,
  usePrimaryConnectionState,
  waitForPrimaryState,
} from "../connection/runtime.ts";
import { createDraft } from "../drafts.ts";
import { failureToast } from "../components/ui/toast.tsx";
import { openProject } from "../uiState.ts";

/** How long the shell may take to show the "No project" project (T3 Code's). */
const SCRATCH_PROJECT_LOAD_TIMEOUT_MS = 10_000;

/** The server's scratch folder while connected and offering it, else null. */
function useScratchWorkspaceRoot(): string | null {
  const state = usePrimaryConnectionState();
  return state?.phase === "connected" ? (state.config?.scratchWorkspaceRoot ?? null) : null;
}

/** Whether a project is "No project", for grouping it apart in the sidebar and palette. */
export function useIsScratchProject(): (project: OrchestrationProjectShell) => boolean {
  const scratchWorkspaceRoot = useScratchWorkspaceRoot();
  return useCallback(
    (project: OrchestrationProjectShell) => isScratchProject(project, scratchWorkspaceRoot),
    [scratchWorkspaceRoot],
  );
}

/**
 * Finds or creates the "No project" project and resolves once the shell
 * has it (T3 Code's `openScratch` and `ScratchProjectNotLoadedError`). A
 * failure is a notice under `failureTitle`, and resolves null.
 */
export async function openScratchProject(
  failureTitle = "Could not start without a project",
): Promise<ProjectId | null> {
  try {
    const { projectId } = await requestPrimary((client) => client["projects.ensureScratch"]({}));
    const hasProject = (state: ReturnType<typeof readPrimaryConnectionState>) =>
      (state?.shell?.projects ?? []).some((project) => project.id === projectId);
    if (!(await waitForPrimaryState(hasProject, SCRATCH_PROJECT_LOAD_TIMEOUT_MS))) {
      throw new Error(`Project ${projectId} did not load.`);
    }
    return projectId;
  } catch (error) {
    failureToast(failureTitle, error);
    return null;
  }
}

/**
 * Threads without a project (T3 Code's `hooks/useScratchProject.ts` at
 * 2577baf): the scratch folder, if offered, and starting a new thread in
 * "No project".
 */
export function useScratchProject() {
  const scratchWorkspaceRoot = useScratchWorkspaceRoot();
  const navigate = useNavigate();

  const startScratchThread = useCallback(async () => {
    const projectId = await openScratchProject();
    if (projectId === null) return;
    openProject(projectId);
    await navigate({
      to: "/draft/$draftId",
      params: { draftId: createDraft(projectId, readPrimaryServerSettings()) },
    });
  }, [navigate]);

  return { scratchWorkspaceRoot, startScratchThread };
}

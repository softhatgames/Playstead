import { CommandId, type ProjectId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import {
  projectRemovalConfirmation,
  projectSettingsRemovalConfirmation,
} from "../components/projectActions.logic.ts";
import {
  readPrimaryConnectionState,
  requestPrimary,
  waitForPrimaryState,
} from "../connection/runtime.ts";
import { discardProjectDrafts } from "../drafts.ts";
import { newId } from "../ids.ts";
import { readLocalApi } from "../localApi.ts";
import { failureToast, warningToast } from "../components/ui/toast.tsx";

/** The project an action is for, from the sidebar's shell. */
export type ProjectActionTarget = Pick<OrchestrationProjectShell, "id" | "title" | "workspaceRoot">;

const commandId = () => CommandId.make(`command:${newId()}`);

/** Gives the project a title the person chose (T3 Code's `project.update {title}`). */
export const renameProject = (projectId: ProjectId, title: string) =>
  requestPrimary((client) =>
    client["projects.mutate"]({ type: "project.update", commandId: commandId(), projectId, title }),
  );

/**
 * Removes the project and deletes its threads (T3 Code's `removeProject` in
 * `LegacySidebar.tsx` at 2577baf, `force: true`), then waits for the shell
 * to drop it and discards the project's drafts. Its folder stays as it is.
 */
async function removeProject(project: ProjectActionTarget): Promise<void> {
  await requestPrimary((client) =>
    client["projects.mutate"]({
      type: "project.delete",
      commandId: commandId(),
      projectId: project.id,
      force: true,
    }),
  );
  await waitForPrimaryState(
    (state) => !(state?.shell?.projects ?? []).some((candidate) => candidate.id === project.id),
  );
  discardProjectDrafts(project.id);
}

/** The project's threads the sidebar shows now. */
const threadCountOf = (projectId: ProjectId) =>
  (readPrimaryConnectionState()?.shell?.threads ?? []).filter(
    (thread) => thread.projectId === projectId,
  ).length;

/**
 * Asks with the latest thread count, as T3 Code reads it after the warning,
 * and removes the project if confirmed. A failure is a notice naming it.
 */
async function confirmAndRemove(
  project: ProjectActionTarget,
  message: (threadCount: number) => string,
): Promise<boolean> {
  const confirmed = await readLocalApi().dialogs.confirm(message(threadCountOf(project.id)), {
    variant: "destructive",
  });
  if (!confirmed) return false;
  try {
    await removeProject(project);
    return true;
  } catch (error) {
    failureToast(
      `Failed to remove "${project.title}"`,
      error instanceof Error ? error : new Error("Unknown error removing project."),
    );
    return false;
  }
}

/**
 * Removes a project from the project tree's menu (T3 Code's
 * `handleRemoveProject` in `LegacySidebar.tsx`): one with threads first
 * shows the warning "Project is not empty" with **Delete anyway**, which then
 * asks to remove it and delete its threads; an empty one is only asked about.
 */
export function removeProjectFromTree(project: ProjectActionTarget): void {
  const ask = (threadCount: number) => projectRemovalConfirmation({ ...project, threadCount });
  if (threadCountOf(project.id) === 0) {
    void confirmAndRemove(project, ask);
    return;
  }
  warningToast("Project is not empty", {
    description: "Delete all threads in this project before removing it.",
    action: {
      label: "Delete anyway",
      destructive: true,
      onClick: () => void confirmAndRemove(project, ask),
    },
  });
}

/**
 * **Project settings → Danger**'s **Remove project** (T3 Code's
 * `removeMembers` in `settings/ProjectSettingsPanel.tsx`): asks at once,
 * and the view goes to the start page once the project is removed.
 */
export function useRemoveProjectFromSettings() {
  const navigate = useNavigate();
  return useCallback(
    async (project: ProjectActionTarget) => {
      const removed = await confirmAndRemove(project, (threadCount) =>
        projectSettingsRemovalConfirmation({ ...project, threadCount }),
      );
      if (removed) await navigate({ to: "/", replace: true });
    },
    [navigate],
  );
}

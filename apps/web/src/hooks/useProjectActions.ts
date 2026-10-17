import { CommandId, type ProjectId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import { useNavigate, useRouter } from "@tanstack/react-router";
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
import { discardProjectDrafts, readDraft } from "../drafts.ts";
import { isScratchProject } from "@playstead/client-runtime/state/projects";
import {
  readSidebarProjectScopeKey,
  setSidebarProjectScopeKey,
  forgetProject,
} from "../uiState.ts";
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
  const scope = readSidebarProjectScopeKey();
  if (
    scope === project.id ||
    (scope === "scratch" &&
      isScratchProject(project, readPrimaryConnectionState()?.config?.scratchWorkspaceRoot))
  )
    setSidebarProjectScopeKey(null);
  forgetProject(project.id);
}

/** Read both active and archived history immediately before asking. */
const threadCountOf = async (projectId: ProjectId) => {
  const archive = await requestPrimary((client) =>
    client["orchestration.getArchivedShellSnapshot"]({}),
  );
  return new Set(
    [...(readPrimaryConnectionState()?.shell?.threads ?? []), ...archive.threads]
      .filter((thread) => thread.projectId === projectId)
      .map((thread) => thread.id),
  ).size;
};

/**
 * Asks with the latest thread count, as T3 Code reads it after the warning,
 * and removes the project if confirmed. A failure is a notice naming it.
 */
async function confirmAndRemove(
  project: ProjectActionTarget,
  message: (threadCount: number) => string,
  onRemoved: () => void,
): Promise<boolean> {
  try {
    const confirmed = await readLocalApi().dialogs.confirm(
      message(await threadCountOf(project.id)),
      { variant: "destructive" },
    );
    if (!confirmed) return false;
    await removeProject(project);
    onRemoved();
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
export function useRemoveProjectFromTree() {
  const navigation = useProjectRemovalNavigation();
  return useCallback(
    (project: ProjectActionTarget) => {
      const onRemoved = navigation(project);
      const ask = (threadCount: number) => projectRemovalConfirmation({ ...project, threadCount });
      void threadCountOf(project.id)
        .then((count) => {
          if (count === 0) {
            void confirmAndRemove(project, ask, onRemoved);
            return;
          }
          warningToast("Project is not empty", {
            description: "Delete all threads in this project before removing it.",
            action: {
              label: "Delete anyway",
              destructive: true,
              onClick: () => void confirmAndRemove(project, ask, onRemoved),
            },
          });
        })
        .catch((error: unknown) => failureToast("Failed to read project threads", error));
    },
    [navigation],
  );
}

/** Only leave a removed project's route, and never overwrite a navigation made during deletion. */
function useProjectRemovalNavigation() {
  const navigate = useNavigate();
  const router = useRouter();
  return useCallback(
    (project: ProjectActionTarget) => {
      const location = router.state.location.href;
      const belongs = router.state.matches.some(
        ({ params }) =>
          ("projectKey" in params && params.projectKey === project.id) ||
          ("threadId" in params &&
            readPrimaryConnectionState()?.shell?.threads.some(
              (thread) => thread.id === params.threadId && thread.projectId === project.id,
            )) ||
          ("draftId" in params && readDraft(params.draftId)?.projectId === project.id),
      );
      return () => {
        if (belongs && router.state.location.href === location)
          void navigate({ to: "/", replace: true });
      };
    },
    [navigate, router],
  );
}

/** Settings uses the same cleanup and route-race guard as the project tree. */
export function useRemoveProjectFromSettings() {
  const navigation = useProjectRemovalNavigation();
  return useCallback(
    (project: ProjectActionTarget) =>
      confirmAndRemove(
        project,
        (threadCount) => projectSettingsRemovalConfirmation({ ...project, threadCount }),
        navigation(project),
      ),
    [navigation],
  );
}

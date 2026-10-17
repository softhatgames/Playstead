import { CommandId, type ProjectId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import { useNavigate } from "@tanstack/react-router";
import { projectRemovalConfirmation } from "../components/projectActions.logic.ts";
import { requestPrimary, usePrimaryConnectionState } from "../connection/runtime.ts";
import { discardProjectDrafts } from "../drafts.ts";
import { newId } from "../ids.ts";
import { readLocalApi } from "../localApi.ts";
import { actionWarningToast, failureToast } from "../toast.ts";
import { setSidebarProjectScopeKey } from "../uiState.ts";

export const renameProject = (projectId: ProjectId, title: string) =>
  requestPrimary((client) =>
    client["projects.mutate"]({
      type: "project.update",
      commandId: CommandId.make(`command:${newId()}`),
      projectId,
      title,
    }),
  );

/** T3 Code's project removal flow: tree warning, destructive confirmation, durable cascade. */
export function useProjectActions() {
  const shell = usePrimaryConnectionState()?.shell;
  const navigate = useNavigate();
  const remove = async (project: OrchestrationProjectShell, warnIfNotEmpty: boolean) => {
    const archived = await requestPrimary((client) =>
      client["orchestration.getArchivedShellSnapshot"]({}),
    );
    const count = [...(shell?.threads ?? []), ...archived.threads].filter(
      (thread) => thread.projectId === project.id,
    ).length;
    const confirm = async () => {
      if (
        !(await readLocalApi().dialogs.confirm(projectRemovalConfirmation(project, count), {
          variant: "destructive",
        }))
      )
        return;
      await requestPrimary((client) =>
        client["projects.mutate"]({
          type: "project.delete",
          commandId: CommandId.make(`command:${newId()}`),
          projectId: project.id,
          force: true,
        }),
      );
      discardProjectDrafts(project.id);
      setSidebarProjectScopeKey(null);
      await navigate({ to: "/", replace: true });
    };
    if (warnIfNotEmpty && count > 0) {
      actionWarningToast(
        "Project is not empty",
        "Delete all threads in this project before removing it.",
        "Delete anyway",
        () => {
          void confirm().catch((error: unknown) => failureToast("Failed to remove project", error));
        },
      );
    } else await confirm();
  };
  return {
    removeProject: (project: OrchestrationProjectShell, warnIfNotEmpty = true) => {
      void remove(project, warnIfNotEmpty).catch((error: unknown) =>
        failureToast("Failed to remove project", error),
      );
    },
  };
}

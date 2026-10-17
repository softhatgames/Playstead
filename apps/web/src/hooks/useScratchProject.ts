import { useNavigate } from "@tanstack/react-router";
import {
  requestPrimary,
  usePrimaryConnectionState,
  waitForPrimaryProject,
} from "../connection/runtime.ts";
import { createDraft } from "../drafts.ts";
import { openProject } from "../uiState.ts";
import { clearThreadSelection } from "../threadSelection.ts";
import { failureToast } from "../toast.ts";

export function useScratchProject() {
  const state = usePrimaryConnectionState();
  const navigate = useNavigate();
  const scratchWorkspaceRoot =
    state?.phase === "connected" ? state.config?.scratchWorkspaceRoot : undefined;
  const openScratchProject = async () => {
    const { projectId } = await requestPrimary((client) => client["projects.ensureScratch"]({}));
    await waitForPrimaryProject(projectId);
    return projectId;
  };
  const startScratchThread = async () => {
    try {
      const projectId = await openScratchProject();
      openProject(projectId);
      clearThreadSelection();
      await navigate({ to: "/draft/$draftId", params: { draftId: createDraft(projectId) } });
    } catch (error) {
      failureToast("Could not start without a project", error);
    }
  };
  return { scratchWorkspaceRoot, openScratchProject, startScratchThread };
}

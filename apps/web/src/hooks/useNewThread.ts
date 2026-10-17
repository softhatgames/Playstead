import type { ProjectId } from "@playstead/contracts/baseSchemas";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { useClientSettings } from "../clientSettings.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { createDraft, useDraft } from "../drafts.ts";
import { buildSidebarProjectGroups } from "../components/Sidebar.inbox.logic.ts";
import { resolveNewThreadProjectId } from "../components/threadNavigation.logic.ts";
import { openProject, useActiveProjectId } from "../uiState.ts";

/**
 * Starting a new thread from where the person is (T3 Code's
 * `useHandleNewThread` and `startNewThreadFromContext` at 2577baf): the
 * project groups in the sidebar's order, the project a new thread starts
 * in (`resolveNewThreadProjectId`; the inbox passes its scope), and the
 * draft it opens. `startInProject` opens a draft in any project.
 */
export function useNewThread(options?: { readonly scopedProjectIds?: ReadonlySet<string> | null }) {
  const state = usePrimaryConnectionState();
  const projects = useMemo(() => state?.shell?.projects ?? [], [state?.shell?.projects]);
  const threads = useMemo(() => state?.shell?.threads ?? [], [state?.shell?.threads]);
  const { sidebarProjectSortOrder } = useClientSettings();
  const { threadId, draftId } = useParams({ strict: false });
  const draft = useDraft(draftId ?? "");
  const openedProjectId = useActiveProjectId();
  const navigate = useNavigate();

  const groups = useMemo(
    () => buildSidebarProjectGroups({ projects, threads, sortOrder: sidebarProjectSortOrder }),
    [projects, threads, sidebarProjectSortOrder],
  );
  const contextProjectId = resolveNewThreadProjectId({
    threadProjectId: threads.find((thread) => thread.id === threadId)?.projectId,
    draftProjectId: draft?.projectId,
    openedProjectId,
    projectIds: groups.flatMap((group) => group.projectIds),
    scopedProjectIds: options?.scopedProjectIds ?? null,
  }) as ProjectId | undefined;

  const startInProject = useCallback(
    (projectId: ProjectId) => {
      openProject(projectId);
      return navigate({ to: "/draft/$draftId", params: { draftId: createDraft(projectId) } });
    },
    [navigate],
  );
  const startFromContext = useCallback(async () => {
    if (contextProjectId !== undefined) await startInProject(contextProjectId);
  }, [contextProjectId, startInProject]);

  return { groups, contextProjectId, startInProject, startFromContext };
}

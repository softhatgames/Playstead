import { isScratchProject } from "@playstead/client-runtime/state/projects";
import { ProjectId } from "@playstead/contracts/baseSchemas";
import { useEffect, useRef, useState } from "react";
import { usePrimaryConnectionState } from "../../connection/runtime.ts";
import { setDraftProject, type ThreadDraft } from "../../drafts.ts";
import { useScratchProject } from "../../hooks/useScratchProject.ts";
import { failureToast } from "../../toast.ts";
import { openProject } from "../../uiState.ts";

export function DraftProjectPicker({
  draft,
  disabled,
}: {
  readonly draft: ThreadDraft;
  readonly disabled: boolean;
}) {
  const state = usePrimaryConnectionState();
  const projects = state?.shell?.projects ?? [];
  const { scratchWorkspaceRoot, openScratchProject } = useScratchProject();
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const scratch = projects.find((project) => isScratchProject(project, scratchWorkspaceRoot));
  return (
    <label className="flex items-center gap-2 px-6 py-3 text-sm text-neutral-500">
      Project
      <select
        aria-label="Draft project"
        className="max-w-72 rounded border border-neutral-300 bg-transparent px-2 py-1 text-neutral-900 dark:border-neutral-700 dark:text-neutral-100"
        value={draft.projectId === scratch?.id ? "scratch" : draft.projectId}
        disabled={disabled || draft.started || pending}
        onChange={(event) => {
          const selected = event.target.value;
          const request = ++generation.current;
          const switchTo = async () => {
            setPending(true);
            try {
              const projectId =
                selected === "scratch" ? await openScratchProject() : ProjectId.make(selected);
              if (request !== generation.current) return;
              setDraftProject(draft.draftId, projectId);
              openProject(projectId);
            } catch (error) {
              failureToast("Could not change the draft's project", error);
            } finally {
              if (request === generation.current) setPending(false);
            }
          };
          void switchTo();
        }}
      >
        {projects
          .filter((project) => !isScratchProject(project, scratchWorkspaceRoot))
          .map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        {scratchWorkspaceRoot ? <option value="scratch">No project</option> : null}
      </select>
    </label>
  );
}

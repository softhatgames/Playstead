import { useEffect, useRef, useState } from "react";

import { renameProject, type ProjectActionTarget } from "../../hooks/useProjectActions.ts";
import { failureToast, warningToast } from "../../toast.ts";
import { resolveProjectRenameCommit } from "../projectActions.logic.ts";

/**
 * **Rename project** (T3 Code's rename dialog in `LegacySidebar.tsx` at
 * 2577baf): the title in a field, **Save** or Enter to rename, **Cancel** or
 * Escape to leave it. A blank title is refused with a notice, and an
 * unchanged one just closes.
 */
export function ProjectRenameDialog(props: {
  readonly project: ProjectActionTarget | null;
  readonly onClose: () => void;
}) {
  const { project, onClose } = props;
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (project !== null) {
      setTitle(project.title);
      if (!element.open) element.showModal();
    } else if (element.open) {
      element.close();
    }
  }, [project]);

  const submit = async () => {
    if (project === null) return;
    const commit = resolveProjectRenameCommit(project.title, title);
    if (commit.kind === "empty") {
      warningToast("Project title cannot be empty");
      return;
    }
    if (commit.kind === "rename") {
      try {
        await renameProject(project.id, commit.title);
      } catch (error) {
        failureToast("Failed to rename project", error);
        return;
      }
    }
    onClose();
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="project-rename-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-full max-w-lg rounded-xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-xl backdrop:bg-black/40 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
    >
      {project === null ? null : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 id="project-rename-title" className="text-base font-semibold">
              Rename project
            </h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              {`Update the title for ${project.workspaceRoot}.`}
            </p>
          </div>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Project title</span>
            <input
              aria-label="Project title"
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
              className="rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

import { usePrimaryConnectionState } from "../../connection/runtime.ts";
import { useRemoveProjectFromSettings } from "../../hooks/useProjectActions.ts";
import { TrashIcon } from "../icons.tsx";

/**
 * **Project settings** (T3 Code's `ProjectSettingsPanel` in
 * `apps/web/src/components/settings/ProjectSettingsPanel.tsx` at 2577baf),
 * reached from the sidebars' **Project settings**. Only its **Danger**
 * section so far, with **Remove project**; the name, icon, defaults and
 * actions wait for slice 5.
 */
export function ProjectSettingsPanel(props: { readonly projectKey: string | null }) {
  const shell = usePrimaryConnectionState()?.shell;
  const removeProject = useRemoveProjectFromSettings();
  const project =
    props.projectKey === null
      ? undefined
      : shell?.projects.find((candidate) => candidate.id === props.projectKey);

  if (shell === undefined) return null;
  if (project === undefined) {
    return (
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        {props.projectKey === null
          ? "Choose a project to manage it."
          : "This project is not available. It may have been removed."}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{project.title}</h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{project.workspaceRoot}</p>
      </div>
      <section aria-labelledby="project-settings-danger" className="flex flex-col gap-2">
        <h2
          id="project-settings-danger"
          className="text-sm font-medium text-neutral-600 dark:text-neutral-300"
        >
          Danger
        </h2>
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Remove project</div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                Deletes the project entry and its threads. Files on disk are not touched.
              </div>
            </div>
            <button
              type="button"
              onClick={() => void removeProject(project)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            >
              <TrashIcon className="size-3.5" />
              Remove project
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

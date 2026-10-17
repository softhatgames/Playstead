import { ProjectId } from "@playstead/contracts/baseSchemas";
import { usePrimaryConnectionState } from "../../connection/runtime.ts";
import { useProjectActions } from "../../hooks/useProjectActions.ts";

/** The removal section of T3 Code's ProjectSettingsPanel at 2577baf. */
export function ProjectSettingsPanel({ projectId }: { readonly projectId: string }) {
  const project = usePrimaryConnectionState()?.shell?.projects.find(
    (project) => project.id === ProjectId.make(projectId),
  );
  const { removeProject } = useProjectActions();
  if (project === undefined) return <p>Project not found.</p>;
  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold">Project settings</h1>
        <p className="mt-2 text-sm">{project.title}</p>
        <p className="mt-1 break-all text-xs text-neutral-500">{project.workspaceRoot}</p>
      </header>
      <section aria-labelledby="project-danger" className="rounded-lg border border-red-500/30 p-4">
        <h2 id="project-danger" className="font-medium text-red-600 dark:text-red-400">
          Danger
        </h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          Remove this project and permanently clear its conversation history, including archived
          threads. Files on disk are not touched.
        </p>
        <button
          type="button"
          onClick={() => removeProject(project, false)}
          className="mt-4 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          Remove project
        </button>
      </section>
    </section>
  );
}

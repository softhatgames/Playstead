import { openCommandPalette } from "../commandPaletteBus.ts";
import { useScratchProject } from "../hooks/useScratchProject.ts";
import { FolderPlusIcon, MessageSquareDashedIcon } from "./icons.tsx";

/**
 * The home page while there are no projects (T3 Code's
 * `apps/web/src/components/NoProjectsHero.tsx` at 2577baf): **Add project**,
 * and **Start without a project** while "No project" is offered.
 */
export function NoProjectsHero() {
  const { scratchWorkspaceRoot, startScratchThread } = useScratchProject();
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-12 text-center">
      <h1 className="text-lg font-medium">What should we work on?</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
        {scratchWorkspaceRoot === null
          ? "Add a project to start your first thread."
          : "Add a project, or start without one."}
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <button
          type="button"
          onClick={() => openCommandPalette({ open: "add-project" })}
          className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          <FolderPlusIcon className="size-4" />
          Add project
        </button>
        {scratchWorkspaceRoot === null ? null : (
          <button
            type="button"
            onClick={() => void startScratchThread()}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            <MessageSquareDashedIcon className="size-4" />
            Start without a project
          </button>
        )}
      </div>
    </div>
  );
}

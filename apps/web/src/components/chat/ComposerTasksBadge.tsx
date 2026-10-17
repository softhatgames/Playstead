import { useState } from "react";

import { CheckIcon, CircleDotIcon, CircleIcon, ListTodoIcon } from "../icons.tsx";
import type { ActiveTasks } from "./plan.logic.ts";

const STATUS_LABELS = { pending: "Pending", running: "Running", completed: "Completed" } as const;

/**
 * The task progress badge (T3 Code's `ComposerTasksBadge` and
 * `ComposerTasksContent`): the running turn's todo list as its current
 * step and how many steps are done, opening to the whole list.
 */
export function ComposerTasksBadge(props: { readonly tasks: ActiveTasks }) {
  const [expanded, setExpanded] = useState(false);
  const { tasks } = props;
  const done = tasks.completed >= tasks.total;
  return (
    <div className="mb-2 rounded-xl border border-neutral-200 text-xs dark:border-neutral-800">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse tasks" : "Tasks"}: ${tasks.completed} of ${tasks.total} complete. Current task: ${tasks.current}`}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ListTodoIcon className="size-3.5 shrink-0" />
        <span className="shrink-0 text-neutral-500 dark:text-neutral-400">Tasks</span>
        <span className="min-w-0 flex-1 truncate font-medium">{tasks.current}</span>
        <span className={`tabular-nums ${done ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
          {tasks.completed}/{tasks.total}
        </span>
      </button>
      {expanded ? (
        <ul
          aria-label={`Task list. ${tasks.completed} of ${tasks.total} complete.`}
          className="flex flex-col gap-1 px-3 pb-2"
        >
          {tasks.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2">
              {step.status === "completed" ? (
                <CheckIcon className="size-3.5 shrink-0 text-emerald-600" />
              ) : step.status === "running" ? (
                <CircleDotIcon className="size-3.5 shrink-0 text-sky-600" />
              ) : (
                <CircleIcon className="size-3.5 shrink-0 text-neutral-400" />
              )}
              <span className={step.status === "completed" ? "text-neutral-500" : ""}>
                <span className="sr-only">{STATUS_LABELS[step.status]}: </span>
                {step.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

import { groupArchivedThreadsByProject } from "@playstead/client-runtime/state/archivedThreads";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { useMemo } from "react";

import { useArchivedThreads } from "../../connection/useArchivedThreads.ts";
import { useThreadActions } from "../../hooks/useThreadActions.ts";
import { readLocalApi } from "../../localApi.ts";
import { failureToast } from "../../toast.ts";
import { archivedThreadMenuItems } from "../threadActionMenu.logic.ts";

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60_000],
  ["month", 30 * 24 * 60 * 60_000],
  ["day", 24 * 60 * 60_000],
  ["hour", 60 * 60_000],
  ["minute", 60_000],
];

/** "5 minutes ago", as T3 Code's `formatRelativeTimeLabel` reads. */
const formatRelative = (iso: string): string => {
  const elapsed = Date.parse(iso) - Date.now();
  for (const [unit, size] of UNITS) {
    if (Math.abs(elapsed) >= size) return relativeTime.format(Math.round(elapsed / size), unit);
  }
  return "just now";
};

/**
 * **Settings → Archive** (T3 Code's `ArchivedThreadsPanel` in
 * `apps/web/src/components/settings/SettingsPanels.tsx` at 2577baf): the
 * archived threads by project, newest archived first, each with
 * **Unarchive** and, in its menu, **Unarchive** and **Delete**.
 */
export function ArchivedThreadsPanel() {
  const archive = useArchivedThreads();
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  const groups = useMemo(
    () => (archive === undefined ? [] : groupArchivedThreadsByProject(archive)),
    [archive],
  );

  const unarchive = (thread: OrchestrationV2ThreadShell) =>
    unarchiveThread(thread.id).catch((error: unknown) =>
      failureToast("Failed to unarchive thread", error),
    );

  const openMenu = async (thread: OrchestrationV2ThreadShell, x: number, y: number) => {
    const chosen = await readLocalApi()
      .contextMenu.show(archivedThreadMenuItems, { x, y })
      .catch(() => null);
    if (chosen === "unarchive") await unarchive(thread);
    if (chosen === "delete") {
      await confirmAndDeleteThread(thread).catch((error: unknown) =>
        failureToast("Failed to delete thread", error),
      );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 id="archive" className="text-xl font-semibold">
        Archive
      </h1>
      {groups.length === 0 ? (
        <section className="rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="text-sm font-medium">
            {archive === undefined ? "Loading archived threads" : "No archived threads"}
          </div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            {archive === undefined ? "Checking the server." : "Archived threads will appear here."}
          </div>
        </section>
      ) : (
        groups.map(({ project, threads }) => (
          <section key={project.id} aria-label={project.title} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
              {project.title}
            </h2>
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {threads.map((thread) => (
                <li
                  key={thread.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void openMenu(thread, event.clientX, event.clientY);
                  }}
                  className="flex items-center gap-4 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{thread.title}</div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400">
                      Archived {formatRelative(thread.archivedAt ?? thread.createdAt)}
                      {" · Created "}
                      {formatRelative(thread.createdAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void unarchive(thread)}
                    className="shrink-0 rounded-md border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    Unarchive
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

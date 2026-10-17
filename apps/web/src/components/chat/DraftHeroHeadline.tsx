import type { ProjectId } from "@playstead/contracts/baseSchemas";
import { useEffect, useRef, useState } from "react";

import { openCommandPalette } from "../../commandPaletteBus.ts";
import { type ThreadDraft, setDraftProject } from "../../drafts.ts";
import { useNewThread } from "../../hooks/useNewThread.ts";
import { openScratchProject, useScratchProject } from "../../hooks/useScratchProject.ts";
import { keybindings, shortcutLabelForCommand } from "../../keybindings.ts";
import { openProject } from "../../uiState.ts";
import { ChevronDownIcon, FolderIcon, FolderPlusIcon } from "../icons.tsx";
import { resolveDraftHeadline } from "./draftHero.logic.ts";

/**
 * A new thread's heading with its project picker (T3 Code's
 * `apps/web/src/components/chat/DraftHeroHeadline.tsx` at 2577baf). Until
 * its first message is sent, a draft can move to any project, or to "No
 * project" with **or start without a project**; once sent, its thread
 * stays where it is.
 */
export function DraftHeroHeadline(props: { readonly draft: ThreadDraft }) {
  const { draft } = props;
  const { groups } = useNewThread();
  const { scratchWorkspaceRoot } = useScratchProject();
  const draftGroup = groups.find((group) => group.projectIds.includes(draft.projectId));
  const isScratchDraft = draftGroup?.isScratch ?? false;
  const choices = groups
    .filter((group) => !group.isScratch)
    .flatMap((group) =>
      group.projectIds.map((projectId) => ({ projectId, label: group.displayName })),
    );
  const headline = resolveDraftHeadline({
    isScratchDraft,
    projectName: draftGroup?.displayName,
    scratchOffered: scratchWorkspaceRoot !== null,
  });

  // Opening "No project" can take a moment; a draft moved meanwhile stays put.
  const latestProjectRef = useRef(draft.projectId);
  latestProjectRef.current = draft.projectId;
  const moveTo = (projectId: ProjectId) => {
    openProject(projectId);
    setDraftProject(draft.draftId, projectId);
  };
  const startWithoutProject = async () => {
    const requestedFrom = draft.projectId;
    const projectId = await openScratchProject();
    if (projectId === null || latestProjectRef.current !== requestedFrom) return;
    moveTo(projectId);
  };

  const picker = (
    <DraftProjectPicker
      label={isScratchDraft ? "No project" : (draftGroup?.displayName ?? "Choose a project")}
      choices={choices}
      selectedProjectId={draft.projectId}
      onChoose={moveTo}
    />
  );
  const noProjectShortcut = shortcutLabelForCommand(keybindings, "chat.newWithoutProject");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 pt-16">
      <h1
        aria-label={headline.label}
        className="w-full text-center text-2xl font-normal tracking-tight"
      >
        {headline.kind === "scratch" ? (
          headline.label
        ) : headline.kind === "project" ? (
          <>What should we build in {picker}?</>
        ) : (
          <>
            <button
              type="button"
              onClick={() => openCommandPalette({ open: "add-project" })}
              className="border-b border-dotted border-neutral-400 text-neutral-500"
            >
              Add a project
            </button>{" "}
            to start
          </>
        )}
      </h1>
      {scratchWorkspaceRoot === null ? null : (
        <p className="mt-2 flex h-6 items-center text-sm">
          {headline.kind === "scratch" ? (
            picker
          ) : headline.kind === "project" && headline.offerScratch ? (
            <button
              type="button"
              title={noProjectShortcut ?? undefined}
              onClick={() => void startWithoutProject()}
              className="text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              or start without a project
            </button>
          ) : null}
        </p>
      )}
    </div>
  );
}

/** The heading's project picker: the projects in the sidebar's order, then **Add project**. */
function DraftProjectPicker(props: {
  readonly label: string;
  readonly choices: ReadonlyArray<{ readonly projectId: ProjectId; readonly label: string }>;
  readonly selectedProjectId: ProjectId;
  readonly onChoose: (projectId: ProjectId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const container = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const trimmed = query.trim().toLowerCase();
  const shown =
    trimmed.length === 0
      ? props.choices
      : props.choices.filter((choice) => choice.label.toLowerCase().includes(trimmed));
  const choose = (projectId: ProjectId) => {
    setOpen(false);
    setQuery("");
    if (projectId !== props.selectedProjectId) props.onChoose(projectId);
  };
  const addProject = () => {
    setOpen(false);
    setQuery("");
    openCommandPalette({ open: "add-project" });
  };

  return (
    <span ref={container} className="relative inline-block align-baseline">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Project: ${props.label}`}
        data-draft-project-trigger=""
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
        }}
        className="inline-flex max-w-64 items-center gap-1 border-b border-dotted border-neutral-400 align-baseline hover:border-neutral-700 dark:hover:border-neutral-200"
      >
        <span className="min-w-0 truncate">{props.label}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-neutral-500" />
      </button>
      {open ? (
        <div className="absolute top-full left-1/2 z-20 mt-1 w-72 -translate-x-1/2 rounded-lg border border-neutral-200 bg-white p-1 text-left text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <input
            autoFocus
            aria-label="Search projects"
            placeholder="Search projects..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              } else if (event.key === "Enter" && shown[0] !== undefined) {
                event.preventDefault();
                choose(shown[0].projectId);
              }
            }}
            className="mb-1 w-full rounded-md bg-neutral-100 px-2 py-1 outline-none dark:bg-neutral-800"
          />
          <ul role="listbox" aria-label="Projects">
            {shown.length === 0 ? (
              <li className="px-2 py-1.5 text-neutral-500">No matching projects.</li>
            ) : (
              shown.map((choice) => (
                <li
                  key={choice.projectId}
                  role="option"
                  aria-selected={choice.projectId === props.selectedProjectId}
                  onClick={() => choose(choice.projectId)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <FolderIcon className="size-4 shrink-0 text-neutral-500" />
                  <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                </li>
              ))
            )}
            {trimmed.length === 0 ? (
              <li
                role="option"
                aria-selected={false}
                onClick={addProject}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <FolderPlusIcon className="size-4 shrink-0 text-neutral-500" />
                <span>Add project</span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </span>
  );
}

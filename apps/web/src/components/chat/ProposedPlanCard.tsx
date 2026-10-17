import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import {
  buildCollapsedProposedPlanPreview,
  buildProposedPlanMarkdownFilename,
  downloadPlanAsTextFile,
  normalizePlanMarkdownForExport,
  proposedPlanTitle,
  stripDisplayedPlanMarkdown,
} from "../../proposedPlan.ts";
import { EllipsisIcon } from "../icons.tsx";

/**
 * A proposed plan in the timeline (T3 Code's `ProposedPlanCard.tsx` at
 * 2577baf): a "Plan" badge and the plan's title, the plan as plain text
 * (replies have no Markdown rendering yet), folded to a preview when long,
 * and **Plan actions**: copy it, download it as Markdown, or save it into
 * the project's folder at a path the person gives.
 */
export function ProposedPlanCard(props: {
  readonly markdown: string;
  readonly streaming: boolean;
  /** The project's folder; without it the plan cannot be saved there. */
  readonly workspaceRoot: string | undefined;
  readonly onSaveToWorkspace: (relativePath: string, contents: string) => Promise<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState<"closed" | "open" | "saving">("closed");
  const [savePath, setSavePath] = useState("");
  const [status, setStatus] = useState<string | undefined>(undefined);
  const menu = useRef<HTMLDivElement | null>(null);
  const pathInputId = useId();

  const title = proposedPlanTitle(props.markdown) ?? "Proposed plan";
  const canCollapse = props.markdown.length > 900 || props.markdown.split("\n").length > 20;
  const collapsed = canCollapse && !expanded;
  const filename = buildProposedPlanMarkdownFilename(props.markdown);
  const contents = normalizePlanMarkdownForExport(props.markdown);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const copy = () => {
    setMenuOpen(false);
    void navigator.clipboard.writeText(contents).then(
      () => setCopied(true),
      () => setStatus("Could not copy plan"),
    );
  };

  const download = () => {
    setMenuOpen(false);
    downloadPlanAsTextFile(filename, contents);
  };

  const openSave = () => {
    setMenuOpen(false);
    setStatus(undefined);
    setSavePath((current) => (current.length > 0 ? current : filename));
    setSaving("open");
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const relativePath = savePath.trim();
    if (relativePath.length === 0) {
      setStatus("Enter a workspace path");
      return;
    }
    setSaving("saving");
    try {
      const saved = await props.onSaveToWorkspace(relativePath, contents);
      setSaving("closed");
      setStatus(`Plan saved to workspace: ${saved}`);
    } catch (cause) {
      setSaving("open");
      setStatus(`Could not save plan: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  return (
    <section
      aria-label={`Plan: ${title}`}
      data-streaming={props.streaming ? "true" : undefined}
      className="rounded-3xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/70"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-md bg-neutral-200 px-1.5 py-0.5 text-xs font-medium dark:bg-neutral-800">
            Plan
          </span>
          <h3 className="truncate text-sm font-medium">{title}</h3>
        </div>
        <div ref={menu} className="relative">
          <button
            type="button"
            aria-label="Plan actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-md border border-neutral-300 p-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <EllipsisIcon className="size-4" />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-10 mt-1 w-48 rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
            >
              <MenuItem onClick={copy}>{copied ? "Copied!" : "Copy to clipboard"}</MenuItem>
              <MenuItem onClick={download}>Download as markdown</MenuItem>
              <MenuItem onClick={openSave} disabled={props.workspaceRoot === undefined}>
                Save to workspace
              </MenuItem>
            </div>
          ) : null}
        </div>
      </div>
      <div
        className={`relative mt-4 text-sm leading-relaxed whitespace-pre-wrap ${collapsed ? "max-h-104 overflow-hidden" : ""}`}
      >
        {collapsed
          ? buildCollapsedProposedPlanPreview(props.markdown, 10)
          : stripDisplayedPlanMarkdown(props.markdown)}
        {props.streaming ? <span className="animate-pulse">▍</span> : null}
      </div>
      {canCollapse ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {expanded ? "Collapse plan" : "Expand plan"}
          </button>
        </div>
      ) : null}
      {saving === "closed" ? null : (
        <form
          aria-label="Save plan to workspace"
          onSubmit={(event) => void save(event)}
          className="mt-4 flex flex-col gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
        >
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Enter a path relative to <code>{props.workspaceRoot ?? "the workspace"}</code>.
          </p>
          <label htmlFor={pathInputId} className="text-xs font-medium">
            Workspace path
          </label>
          <input
            id={pathInputId}
            value={savePath}
            onChange={(event) => setSavePath(event.target.value)}
            placeholder={filename}
            spellCheck={false}
            disabled={saving === "saving"}
            className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={saving === "saving"}
              onClick={() => setSaving("closed")}
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving === "saving"}
              className="rounded-md bg-neutral-900 px-2 py-1 text-xs text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              {saving === "saving" ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      )}
      {status === undefined ? null : (
        <p role="status" className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">
          {status}
        </p>
      )}
    </section>
  );
}

function MenuItem(props: {
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly children: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={props.disabled}
      onClick={props.onClick}
      className="block w-full px-3 py-1.5 text-left hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
    >
      {props.children}
    </button>
  );
}

import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useDismissOnOutsidePointer } from "../../hooks/useDismissOnOutsidePointer.ts";
import type { SidebarProjectGroup } from "../../sidebarProjectGrouping.ts";
import { setSidebarProjectScopeKey } from "../../uiState.ts";
import { FolderIcon, ListFilterIcon, SettingsIcon } from "../icons.tsx";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader.tsx";

/**
 * The project scope menu (T3 Code's `Combobox` in the sidebar header of
 * `apps/web/src/components/Sidebar.tsx` at 2577baf): **All projects** or one
 * group, with **Search projects...** to narrow it. A project's gear, or a
 * right-click on it, opens its settings.
 */
export function SidebarProjectScopeMenu(props: {
  readonly groups: ReadonlyArray<SidebarProjectGroup>;
  readonly scopedGroup: SidebarProjectGroup | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useDismissOnOutsidePointer(open, () => setOpen(false));

  const items = [
    { key: null, label: "All projects" },
    ...props.groups.map((group) => ({ key: group.key, label: group.displayName })),
  ];
  const trimmed = query.trim().toLowerCase();
  const shown =
    trimmed.length === 0
      ? items
      : items.filter((item) => item.key !== null && item.label.toLowerCase().includes(trimmed));
  const choose = (key: string | null) => {
    setSidebarProjectScopeKey(key);
    setOpen(false);
    setQuery("");
  };
  const navigate = useNavigate();
  // T3 Code's `openProjectSettings`: the gear, or right-click, on a project.
  const openProjectSettings = (group: SidebarProjectGroup) => {
    setOpen(false);
    setQuery("");
    void navigate({ to: "/projects/$projectKey", params: { projectKey: group.key } });
  };

  return (
    <div ref={rootRef} className="relative">
      <SidebarHeaderIconButton
        label={
          props.scopedGroup === null
            ? "Filter threads by project"
            : `Filter threads by project: ${props.scopedGroup.displayName}`
        }
        onClick={() => {
          setOpen((value) => !value);
          setQuery("");
        }}
      >
        {props.scopedGroup === null ? (
          <ListFilterIcon className="size-4" />
        ) : (
          <FolderIcon className="size-4 text-sky-600 dark:text-sky-400" />
        )}
      </SidebarHeaderIconButton>
      {open ? (
        <div className="absolute top-full right-0 z-20 mt-1 w-60 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
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
                choose(shown[0].key);
              }
            }}
            className="mb-1 w-full rounded-md bg-neutral-100 px-2 py-1 text-sm outline-none dark:bg-neutral-800"
          />
          {shown.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-neutral-500">No matching projects.</div>
          ) : (
            <ul role="listbox" aria-label="Projects">
              {shown.map((item) => {
                const selected = (props.scopedGroup?.key ?? null) === item.key;
                // "No project" has no project settings, as in T3 Code.
                const group =
                  item.key === null
                    ? undefined
                    : props.groups.find(
                        (candidate) => candidate.key === item.key && !candidate.isScratch,
                      );
                return (
                  <li
                    key={item.key ?? "all"}
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(item.key)}
                    onContextMenu={(event) => {
                      if (group === undefined) return;
                      event.preventDefault();
                      openProjectSettings(group);
                    }}
                    className={`group/scope flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                      selected ? "font-medium" : ""
                    }`}
                  >
                    <FolderIcon className="size-4 shrink-0 text-neutral-500" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {group === undefined ? null : (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-hidden="true"
                        title={`Project settings for ${group.displayName}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          openProjectSettings(group);
                        }}
                        className="ml-auto rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-900 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                      >
                        <SettingsIcon className="size-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

import type { MouseEvent } from "react";
import type { ContextMenuPosition } from "@playstead/contracts/ipc";
import type { ProjectId } from "@playstead/contracts/baseSchemas";
import { isMacPlatform } from "@playstead/shared/keybindings";
import {
  clearThreadSelection,
  rangeSelectThreadsTo,
  readThreadSelection,
  setThreadSelectionAnchor,
  toggleThreadSelection,
} from "../threadSelection.ts";
import { openProject } from "../uiState.ts";
import { isTrailingDoubleClick } from "../components/Sidebar.logic.ts";

/** Mod-click on a Mac is Command, elsewhere Control (T3 Code's `isModClick`). */
const isModClick = (event: Pick<MouseEvent, "metaKey" | "ctrlKey">) =>
  isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;

/** Shared click, rename and selection-aware menu policy for both sidebar layouts. */
export function threadRowInteractions(input: {
  readonly thread: { readonly id: string; readonly projectId: ProjectId };
  readonly orderedIds: () => ReadonlyArray<string>;
  readonly rename: () => void;
  readonly bulkMenu: (position: ContextMenuPosition) => void;
  readonly menu: (position: ContextMenuPosition) => void;
}): {
  onClick: (event: MouseEvent) => void;
  onDoubleClick: (event: MouseEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
} {
  return {
    onClick: (event) => {
      if (isModClick(event)) {
        event.preventDefault();
        toggleThreadSelection(input.thread.id);
        return;
      }
      if (event.shiftKey) {
        event.preventDefault();
        rangeSelectThreadsTo(input.thread.id, input.orderedIds());
        return;
      }
      if (isTrailingDoubleClick(event.detail)) {
        event.preventDefault();
        return;
      }
      clearThreadSelection();
      setThreadSelectionAnchor(input.thread.id);
      openProject(input.thread.projectId);
    },
    onDoubleClick: (event) => {
      event.preventDefault();
      input.rename();
    },
    onContextMenu: (event) => {
      event.preventDefault();
      const position = { x: event.clientX, y: event.clientY };
      if (readThreadSelection().selectedThreadIds.has(input.thread.id)) {
        input.bulkMenu(position);
        return;
      }
      clearThreadSelection();
      input.menu(position);
    },
  };
}

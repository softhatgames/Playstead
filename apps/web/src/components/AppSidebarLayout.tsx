import { type ReactNode, useEffect, useRef } from "react";

import { APP_DISPLAY_NAME } from "../branding.ts";
import { useClientSettings } from "../clientSettings.ts";
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus.ts";
import { useNewThread } from "../hooks/useNewThread.ts";
import { useScratchProject } from "../hooks/useScratchProject.ts";
import { undoLatestThreadAction } from "../hooks/showThreadUndoNotice.ts";
import { isEditableTarget, keybindings, resolveShortcutCommand } from "../keybindings.ts";
import { clearThreadSelection, readThreadSelection } from "../threadSelection.ts";
import { toggleSidebarOpen, useSidebarOpen } from "../uiState.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import { LegacySidebar } from "./LegacySidebar.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { SidebarThreadUndoNotice } from "./sidebar/SidebarThreadUndoNotice.tsx";

/**
 * The page's own shortcuts (T3 Code's `SidebarControl` in
 * `AppSidebarLayout.tsx` and `ChatRouteGlobalShortcuts` in `routes/_chat.tsx`
 * at 2577baf): `mod+b` shows or hides the sidebar, `mod+z` undoes the
 * latest thread action while no text field has focus, Escape clears a
 * multiple selection, `mod+shift+n` starts a thread in the current project
 * and `mod+n` does too, unless the inbox sidebar has several project groups:
 * then it opens **New thread in…**. `mod+alt+n` starts a thread without a
 * project while "No project" is offered. All stand aside while the command
 * palette is open.
 */
function useGlobalShortcuts(legacySidebarEnabled: boolean) {
  const { groups, startFromContext } = useNewThread();
  const { scratchWorkspaceRoot, startScratchThread } = useScratchProject();
  const latest = useRef({
    legacySidebarEnabled,
    groupCount: groups.length,
    startFromContext,
    scratchWorkspaceRoot,
    startScratchThread,
  });
  latest.current = {
    legacySidebarEnabled,
    groupCount: groups.length,
    startFromContext,
    scratchWorkspaceRoot,
    startScratchThread,
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: { editableFocus: isEditableTarget(event.target) },
      });
      if (command === "chat.new" || command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        const { legacySidebarEnabled, groupCount, startFromContext } = latest.current;
        if (command === "chat.new" && !legacySidebarEnabled && groupCount > 1) {
          openCommandPalette({ open: "new-thread-in" });
          return;
        }
        void startFromContext();
        return;
      }
      if (command === "chat.newWithoutProject") {
        const { scratchWorkspaceRoot, startScratchThread } = latest.current;
        if (scratchWorkspaceRoot === null) return;
        event.preventDefault();
        event.stopPropagation();
        void startScratchThread();
        return;
      }
      if (command === "sidebar.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleSidebarOpen();
        return;
      }
      if (command === "thread.undo") {
        if (event.repeat) return;
        if (undoLatestThreadAction()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (event.key === "Escape" && readThreadSelection().selectedThreadIds.size > 0) {
        event.preventDefault();
        clearThreadSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

/**
 * The signed-in page: the sidebar on the left and the page beside it, with
 * the command palette over both (T3 Code's
 * `apps/web/src/components/AppSidebarLayout.tsx` at 2577baf). The sidebar is
 * the inbox one, or the project tree when **Settings → General → Sidebar
 * (legacy)** is on; the Undo notice sits below either.
 */
export function AppSidebarLayout({ children }: { readonly children: ReactNode }) {
  const { legacySidebarEnabled } = useClientSettings();
  const sidebarOpen = useSidebarOpen();
  useGlobalShortcuts(legacySidebarEnabled);
  return (
    <div className="flex h-screen">
      {sidebarOpen ? (
        <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40">
          <div className="px-4 pt-4 pb-2 text-sm font-semibold">{APP_DISPLAY_NAME}</div>
          {legacySidebarEnabled ? <LegacySidebar /> : <Sidebar />}
          <SidebarThreadUndoNotice />
        </aside>
      ) : null}
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
      <CommandPalette />
    </div>
  );
}

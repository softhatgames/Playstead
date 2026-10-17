import { type ReactNode, useEffect } from "react";

import { APP_DISPLAY_NAME } from "../branding.ts";
import { useClientSettings } from "../clientSettings.ts";
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
 * latest thread action while no text field has focus, and Escape clears a
 * multiple selection.
 */
function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: { editableFocus: isEditableTarget(event.target) },
      });
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
  useGlobalShortcuts();
  return (
    <div className="flex h-screen">
      <aside
        data-state={sidebarOpen ? "expanded" : "collapsed"}
        inert={!sidebarOpen}
        className={`flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40 ${sidebarOpen ? "" : "-ml-64"}`}
      >
        <div className="px-4 pt-4 pb-2 text-sm font-semibold">{APP_DISPLAY_NAME}</div>
        {legacySidebarEnabled ? <LegacySidebar /> : <Sidebar />}
        <SidebarThreadUndoNotice />
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
      <CommandPalette />
    </div>
  );
}

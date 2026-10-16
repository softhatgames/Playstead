import type { ReactNode } from "react";

import { APP_DISPLAY_NAME } from "../branding.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import { Sidebar } from "./Sidebar.tsx";

/**
 * The signed-in page: the project sidebar on the left and the page beside it,
 * with the command palette over both (T3 Code's
 * `apps/web/src/components/AppSidebarLayout.tsx` at 2577baf).
 */
export function AppSidebarLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-screen">
      <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="px-4 pt-4 pb-2 text-sm font-semibold">{APP_DISPLAY_NAME}</div>
        <Sidebar />
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
      <CommandPalette />
    </div>
  );
}

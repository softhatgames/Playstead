import { undoLatestThreadAction, useThreadUndoNotice } from "../../hooks/showThreadUndoNotice.ts";
import { keybindings, shortcutLabelForCommand } from "../../keybindings.ts";

/**
 * The sidebar's Undo notice, "Settled 2 threads, ⌘Z to undo" (T3 Code's
 * `apps/web/src/components/sidebar/SidebarThreadUndoNotice.tsx` at 2577baf).
 */
export function SidebarThreadUndoNotice() {
  const notice = useThreadUndoNotice();
  if (notice === null) return null;
  const shortcut = shortcutLabelForCommand(keybindings, "thread.undo");
  const noun = `thread${notice.count === 1 ? "" : "s"}`;
  return (
    <div
      role="status"
      className="mx-2 mb-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
    >
      {notice.action} {notice.count} {noun},{" "}
      <button
        type="button"
        onClick={undoLatestThreadAction}
        className="font-medium underline-offset-2 hover:underline"
      >
        {shortcut === null ? "Undo" : `${shortcut} to undo`}
      </button>
    </div>
  );
}

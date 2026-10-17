import { useEffect, useRef } from "react";

import { copyTextToClipboard } from "../clipboard.ts";
import { isCommandPaletteOpen } from "../commandPaletteBus.ts";
import { keybindings, resolveShortcutCommand } from "../keybindings.ts";
import { settleAndAdvance } from "../settleAndAdvance.ts";
import { failureToast, successToast } from "../toast.ts";
import {
  pinThread,
  settleThread,
  type ThreadLifecycleTarget,
  unpinThread,
  unsettleThread,
} from "./useThreadActions.ts";

/**
 * The thread view's shortcuts (T3 Code's `thread.settle` and `thread.pin`
 * and `thread.copyReference` handling in `apps/web/src/components/ChatView.tsx`
 * at 2577baf): `mod+shift+s` settles the thread in view, moving on as the
 * inbox sidebar does, or un-settles a settled one; `mod+shift+p` pins or
 * unpins it; `mod+shift+c` copies its ID (T3 Code copies a pull request's
 * link instead when the thread has one; Playstead has none). The command
 * palette handles them itself while it is open.
 */

/** Copies the thread's ID, saying so (T3 Code's `copyActiveThreadReference`). */
export function copyThreadReference(threadId: string): Promise<void> {
  return copyTextToClipboard(threadId).then(
    () => successToast("Thread ID copied", threadId),
    (error: unknown) => failureToast("Failed to copy thread ID", error),
  );
}
export function useThreadShortcuts(thread: ThreadLifecycleTarget | null): void {
  const threadRef = useRef(thread);
  threadRef.current = thread;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings);
      const current = threadRef.current;
      if (command === "thread.copyReference") {
        if (current === null) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) void copyThreadReference(current.id);
        return;
      }
      if (command !== "thread.settle" && command !== "thread.pin") return;
      event.preventDefault();
      event.stopPropagation();
      if (current === null || event.repeat) return;
      if (command === "thread.settle") {
        if (current.settledOverride === "settled") {
          unsettleThread(current.id).catch((error: unknown) =>
            failureToast("Failed to un-settle thread", error),
          );
          return;
        }
        if (settleAndAdvance(current)) return;
        settleThread(current).catch((error: unknown) =>
          failureToast("Failed to settle thread", error),
        );
        return;
      }
      const pinned = current.pinnedAt !== null;
      (pinned ? unpinThread(current) : pinThread(current.id)).catch((error: unknown) =>
        failureToast(pinned ? "Failed to unpin thread" : "Failed to pin thread", error),
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

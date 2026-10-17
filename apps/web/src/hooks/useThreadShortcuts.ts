import { useEffect, useRef } from "react";

import { keybindings, resolveShortcutCommand } from "../keybindings.ts";
import { settleAndAdvance } from "../settleAndAdvance.ts";
import { failureToast } from "../toast.ts";
import {
  pinThread,
  settleThread,
  type ThreadLifecycleTarget,
  confirmAndUnpinThread,
  unsettleThread,
} from "./useThreadActions.ts";

/**
 * The thread view's shortcuts (T3 Code's `thread.settle` and `thread.pin`
 * handling in `apps/web/src/components/ChatView.tsx` at 2577baf):
 * `mod+shift+s` settles the thread in view, moving on as the inbox sidebar
 * does, or un-settles a settled one; `mod+shift+p` pins or unpins it.
 */
export function useThreadShortcuts(thread: ThreadLifecycleTarget | null): void {
  const threadRef = useRef(thread);
  threadRef.current = thread;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings);
      const current = threadRef.current;
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
      (pinned ? confirmAndUnpinThread(current) : pinThread(current.id)).catch((error: unknown) =>
        failureToast(pinned ? "Failed to unpin thread" : "Failed to pin thread", error),
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

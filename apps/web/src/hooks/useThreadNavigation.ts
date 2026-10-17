import { ThreadId } from "@playstead/contracts/baseSchemas";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { isCommandPaletteOpen } from "../commandPaletteBus.ts";
import { isElectron } from "../env.ts";
import { keybindings, resolveShortcutCommand } from "../keybindings.ts";
import { threadNavigationTarget } from "../threadNavigation.ts";
import { clearThreadSelection } from "../threadSelection.ts";

/** Each sidebar supplies its own visible order, including its expanded shelves. */
export function useThreadNavigation(orderedIds: ReadonlyArray<string>): void {
  const { threadId } = useParams({ strict: false });
  const navigate = useNavigate();
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        isCommandPaletteOpen() ||
        document.querySelector('[role="dialog"], dialog[open]')
      )
        return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: { isDesktop: isElectron },
      });
      const target = threadNavigationTarget(orderedIds, threadId, command);
      if (target === null) return;
      event.preventDefault();
      clearThreadSelection();
      void navigate({ to: "/threads/$threadId", params: { threadId: ThreadId.make(target) } });
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [orderedIds, threadId, navigate]);
}

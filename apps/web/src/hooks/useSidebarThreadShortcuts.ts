import type { ThreadId } from "@playstead/contracts/baseSchemas";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus.ts";
import {
  createThreadJumpHintVisibilityController,
  resolveAdjacentThreadId,
  THREAD_JUMP_HINT_SHOW_DELAY_MS,
} from "../components/threadNavigation.logic.ts";
import {
  keybindings,
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings.ts";
import { clearThreadSelection, readThreadSelection } from "../threadSelectionStore.ts";
import { openProject } from "../uiState.ts";

interface ShortcutThread {
  readonly id: string;
  readonly projectId: string;
}

interface ModifierState {
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const NO_MODIFIERS: ModifierState = {
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};
const NO_LABELS: ReadonlyMap<string, string> = new Map();

const modifierOf = (key: string): keyof ModifierState | null =>
  key === "Meta" || key === "OS"
    ? "metaKey"
    : key === "Control"
      ? "ctrlKey"
      : key === "Alt"
        ? "altKey"
        : key === "Shift"
          ? "shiftKey"
          : null;

/**
 * The modifiers held now (T3 Code's `useShortcutModifierState`). A pressed
 * or released modifier changes its own flag; any other key keeps a flag
 * only if the event still reports it, so a modifier whose release never
 * arrived does not stay held. Pasting or leaving the window lets go of all.
 */
function useShortcutModifierState(): ModifierState {
  const [state, setState] = useState(NO_MODIFIERS);
  const stateRef = useRef(NO_MODIFIERS);
  useEffect(() => {
    const update = (next: ModifierState) => {
      const current = stateRef.current;
      if (
        current.metaKey === next.metaKey &&
        current.ctrlKey === next.ctrlKey &&
        current.altKey === next.altKey &&
        current.shiftKey === next.shiftKey
      ) {
        return;
      }
      stateRef.current = next;
      setState(next);
    };
    const onKey = (event: KeyboardEvent) => {
      const current = stateRef.current;
      const modifier = modifierOf(event.key);
      update(
        modifier !== null
          ? { ...current, [modifier]: event.type === "keydown" }
          : {
              metaKey: current.metaKey && event.metaKey,
              ctrlKey: current.ctrlKey && event.ctrlKey,
              altKey: current.altKey && event.altKey,
              shiftKey: current.shiftKey && event.shiftKey,
            },
      );
    };
    const reset = () => update(NO_MODIFIERS);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("paste", reset, true);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("paste", reset, true);
      window.removeEventListener("blur", reset);
    };
  }, []);
  return state;
}

/**
 * The sidebar's thread shortcuts (T3 Code's in `Sidebar.tsx` and
 * `LegacySidebar.tsx` at 2577baf): `mod+shift+[` and `]` open the thread
 * above or below the one in view, and in the desktop app `mod+1` to
 * `mod+9` open the first nine rows. `threads` are the rows as shown.
 * Returns each row's jump key while the jump modifier is held, for the
 * rows to show.
 */
export function useSidebarThreadShortcuts(
  threads: ReadonlyArray<ShortcutThread>,
  routeThreadId: string | undefined,
): ReadonlyMap<string, string> {
  const navigate = useNavigate();
  const latest = useRef({ threads, routeThreadId });
  latest.current = { threads, routeThreadId };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings);
      const { threads: rows, routeThreadId: currentId } = latest.current;
      const direction = threadTraversalDirectionFromCommand(command);
      const jumpIndex = threadJumpIndexFromCommand(command);
      const targetId =
        direction !== null
          ? resolveAdjacentThreadId({
              threadIds: rows.map((row) => row.id),
              currentThreadId: currentId ?? null,
              direction,
            })
          : jumpIndex !== null
            ? (rows[jumpIndex]?.id ?? null)
            : null;
      const target = targetId === null ? undefined : rows.find((row) => row.id === targetId);
      if (target === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      if (readThreadSelection().selectedThreadIds.size > 0) clearThreadSelection();
      openProject(target.projectId);
      void navigate({ to: "/threads/$threadId", params: { threadId: target.id as ThreadId } });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  const labels = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const [index, thread] of threads.entries()) {
      const command = threadJumpCommandForIndex(index);
      if (command === null) break;
      const label = shortcutLabelForCommand(keybindings, command);
      if (label !== null) mapping.set(thread.id, label);
    }
    return mapping;
  }, [threads]);

  const [showHints, setShowHints] = useState(false);
  const controllerRef = useRef<ReturnType<typeof createThreadJumpHintVisibilityController> | null>(
    null,
  );
  useEffect(() => {
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: setShowHints,
      setTimeoutFn: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeoutFn: (id) => window.clearTimeout(id),
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);
  const modifiers = useShortcutModifierState();
  const shouldShow = shouldShowThreadJumpHintsForModifiers(modifiers, keybindings);
  useEffect(() => controllerRef.current?.sync(shouldShow), [shouldShow]);

  return showHints ? labels : NO_LABELS;
}

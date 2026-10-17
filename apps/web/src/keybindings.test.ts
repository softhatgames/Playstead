import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@playstead/shared/keybindings";

import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "./keybindings.ts";

/**
 * T3 Code's keybinding resolver (`apps/web/src/keybindings.test.ts` and
 * `packages/shared/src/keybindings.ts` at 2577baf), as behaviour: the
 * default bindings this slice uses, `mod` as Command on a Mac and Control
 * elsewhere, and `when` clauses read from the focus.
 */

const MAC = "MacIntel";
const WINDOWS = "Win32";

const key = (
  value: string,
  modifiers: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>> = {},
  code?: string,
) => ({
  key: value,
  ...(code === undefined ? {} : { code }),
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

const resolve = (
  event: ReturnType<typeof key>,
  platform: string,
  context: Record<string, boolean> = {},
) => resolveShortcutCommand(event, DEFAULT_RESOLVED_KEYBINDINGS, { platform, context });

describe("keyboard shortcuts", () => {
  it("settle and pin are mod+shift+s and mod+shift+p, with Command on a Mac and Control elsewhere", () => {
    expect(resolve(key("S", { metaKey: true, shiftKey: true }, "KeyS"), MAC)).toBe("thread.settle");
    expect(resolve(key("S", { ctrlKey: true, shiftKey: true }, "KeyS"), WINDOWS)).toBe(
      "thread.settle",
    );
    expect(resolve(key("S", { ctrlKey: true, shiftKey: true }, "KeyS"), MAC)).toBeNull();
    expect(resolve(key("P", { metaKey: true, shiftKey: true }, "KeyP"), MAC)).toBe("thread.pin");
    expect(resolve(key("s", { metaKey: true }, "KeyS"), MAC)).toBeNull();
  });

  it("mod+b toggles the sidebar", () => {
    expect(resolve(key("b", { metaKey: true }, "KeyB"), MAC)).toBe("sidebar.toggle");
    expect(resolve(key("b", { ctrlKey: true }, "KeyB"), WINDOWS)).toBe("sidebar.toggle");
  });

  it("mod+z undoes a thread action only while no text field has focus", () => {
    expect(resolve(key("z", { metaKey: true }, "KeyZ"), MAC)).toBe("thread.undo");
    expect(resolve(key("z", { metaKey: true }, "KeyZ"), MAC, { editableFocus: true })).toBeNull();
  });

  it("a letter matches by its physical key on another keyboard layout", () => {
    // A Russian layout types "я" on the Z key.
    expect(resolve(key("я", { metaKey: true }, "KeyZ"), MAC)).toBe("thread.undo");
  });

  it("labels a command's shortcut in each platform's style", () => {
    expect(shortcutLabelForCommand(DEFAULT_RESOLVED_KEYBINDINGS, "thread.undo", MAC)).toBe("⌘Z");
    expect(shortcutLabelForCommand(DEFAULT_RESOLVED_KEYBINDINGS, "thread.settle", MAC)).toBe("⇧⌘S");
    expect(shortcutLabelForCommand(DEFAULT_RESOLVED_KEYBINDINGS, "thread.settle", WINDOWS)).toBe(
      "Ctrl+Shift+S",
    );
  });

  it("mod+k toggles the command palette and mod+n starts a new thread", () => {
    expect(resolve(key("k", { metaKey: true }, "KeyK"), MAC)).toBe("commandPalette.toggle");
    expect(resolve(key("k", { ctrlKey: true }, "KeyK"), WINDOWS)).toBe("commandPalette.toggle");
    expect(resolve(key("n", { metaKey: true }, "KeyN"), MAC)).toBe("chat.new");
    expect(resolve(key("O", { metaKey: true, shiftKey: true }, "KeyO"), MAC)).toBe("chat.new");
    expect(resolve(key("N", { metaKey: true, shiftKey: true }, "KeyN"), MAC)).toBe("chat.newLocal");
  });

  it("mod+alt+n starts a thread without a project", () => {
    // Option+N types a dead key on a Mac; the physical key still counts.
    expect(resolve(key("˜", { metaKey: true, altKey: true }, "KeyN"), MAC)).toBe(
      "chat.newWithoutProject",
    );
    expect(resolve(key("n", { ctrlKey: true, altKey: true }, "KeyN"), WINDOWS)).toBe(
      "chat.newWithoutProject",
    );
    expect(
      shortcutLabelForCommand(DEFAULT_RESOLVED_KEYBINDINGS, "chat.newWithoutProject", MAC),
    ).toBe("⌥⌘N");
  });

  it("mod+shift+[ and ] move to the previous and next thread", () => {
    const previous = resolve(key("{", { metaKey: true, shiftKey: true }, "BracketLeft"), MAC);
    const next = resolve(key("}", { metaKey: true, shiftKey: true }, "BracketRight"), MAC);
    expect(previous).toBe("thread.previous");
    expect(next).toBe("thread.next");
    expect(threadTraversalDirectionFromCommand(previous)).toBe("previous");
    expect(threadTraversalDirectionFromCommand(next)).toBe("next");
    expect(threadTraversalDirectionFromCommand("thread.pin")).toBeNull();
  });

  it("mod+shift+c copies the thread reference", () => {
    expect(resolve(key("C", { metaKey: true, shiftKey: true }, "KeyC"), MAC)).toBe(
      "thread.copyReference",
    );
  });

  it("mod+1 to mod+9 jump to the sidebar's threads in the desktop app only", () => {
    const one = key("1", { metaKey: true }, "Digit1");
    expect(resolve(one, MAC, { isDesktop: true })).toBe("thread.jump.1");
    expect(resolve(key("9", { ctrlKey: true }, "Digit9"), WINDOWS, { isDesktop: true })).toBe(
      "thread.jump.9",
    );
    expect(resolve(one, MAC, { isDesktop: false })).toBeNull();
    expect(threadJumpIndexFromCommand("thread.jump.3")).toBe(2);
    expect(threadJumpIndexFromCommand("thread.pin")).toBeNull();
    expect(threadJumpCommandForIndex(8)).toBe("thread.jump.9");
    expect(threadJumpCommandForIndex(9)).toBeNull();
  });

  it("shows the jump hints while the jump modifier alone is held, on the desktop", () => {
    const held = (
      modifiers: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>>,
    ) => ({
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...modifiers,
    });
    const show = (modifiers: ReturnType<typeof held>, platform: string, isDesktop = true) =>
      shouldShowThreadJumpHintsForModifiers(modifiers, DEFAULT_RESOLVED_KEYBINDINGS, {
        platform,
        context: { isDesktop },
      });
    expect(show(held({ metaKey: true }), MAC)).toBe(true);
    expect(show(held({ ctrlKey: true }), WINDOWS)).toBe(true);
    expect(show(held({ metaKey: true, shiftKey: true }), MAC)).toBe(false);
    expect(show(held({ ctrlKey: true }), MAC)).toBe(false);
    expect(show(held({ metaKey: true }), MAC, false)).toBe(false);
  });

  it("labels a jump only where it applies, and a command by the binding that wins", () => {
    expect(
      shortcutLabelForCommand(DEFAULT_RESOLVED_KEYBINDINGS, "thread.jump.2", MAC, {
        isDesktop: true,
      }),
    ).toBe("⌘2");
    expect(
      shortcutLabelForCommand(DEFAULT_RESOLVED_KEYBINDINGS, "thread.jump.2", MAC, {
        isDesktop: false,
      }),
    ).toBeNull();
    expect(
      shortcutLabelForCommand(DEFAULT_RESOLVED_KEYBINDINGS, "commandPalette.toggle", MAC),
    ).toBe("⌘K");
    // T3 Code lists mod+shift+o after mod+n, so its label is the one shown.
    expect(shortcutLabelForCommand(DEFAULT_RESOLVED_KEYBINDINGS, "chat.new", MAC)).toBe("⇧⌘O");
  });
});

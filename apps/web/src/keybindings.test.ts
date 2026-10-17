import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@playstead/shared/keybindings";

import { resolveShortcutCommand, shortcutLabelForCommand } from "./keybindings.ts";

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
});

it("opens the palette and project-aware new thread, traverses threads and copies their reference", () => {
  expect(resolve(key("k", { metaKey: true }), MAC)).toBe("commandPalette.toggle");
  expect(resolve(key("n", { ctrlKey: true }), WINDOWS)).toBe("chat.new");
  expect(resolve(key("N", { metaKey: true, shiftKey: true }), MAC)).toBe("chat.newLocal");
  expect(resolve(key("{", { metaKey: true, shiftKey: true }, "BracketLeft"), MAC)).toBe(
    "thread.previous",
  );
  expect(resolve(key("}", { ctrlKey: true, shiftKey: true }, "BracketRight"), WINDOWS)).toBe(
    "thread.next",
  );
  expect(resolve(key("C", { metaKey: true, shiftKey: true }), MAC)).toBe("thread.copyReference");
});

it("reserves all nine numbered thread jumps for desktop, leaving browser tab shortcuts alone", () => {
  for (let index = 1; index <= 9; index += 1) {
    const event = key(String(index), { ctrlKey: true }, `Digit${index}`);
    expect(resolve(event, WINDOWS, { isDesktop: true })).toBe(`thread.jump.${index}`);
    expect(resolve(event, WINDOWS, { isDesktop: false })).toBeNull();
    expect(resolve(event, WINDOWS, { isDesktop: true, modelPickerOpen: true })).toBeNull();
  }
});

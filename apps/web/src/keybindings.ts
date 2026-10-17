import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  isMacPlatform,
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  matchesKeybindingShortcut,
  matchesKeybindingShortcutModifiers,
  type ResolvedKeybindingsConfig,
  type ShortcutEventLike,
  type ShortcutModifierStateLike,
  THREAD_JUMP_KEYBINDING_COMMANDS,
  type ThreadJumpKeybindingCommand,
} from "@playstead/shared/keybindings";

/**
 * Which command a key press runs, and how a command's shortcut is written
 * (T3 Code's `apps/web/src/keybindings.ts` at 2577baf, trimmed to the
 * resolver and labels). The page's bindings are the defaults until
 * **Settings → Keybindings** (slice 5) can change them.
 */

export const keybindings: ResolvedKeybindingsConfig = DEFAULT_RESOLVED_KEYBINDINGS;

/**
 * What `when` clauses read. A name not given is false, except `isDesktop`
 * and `isWeb`, which default to where the page runs (T3 Code's `resolveContext`).
 */
export type ShortcutMatchContext = Readonly<Record<string, boolean>>;

interface ShortcutMatchOptions {
  readonly platform?: string;
  readonly context?: ShortcutMatchContext;
}

const platformOf = (options: ShortcutMatchOptions | undefined) =>
  options?.platform ?? navigator.platform;

const contextOf = (options: ShortcutMatchOptions | undefined): ShortcutMatchContext => {
  const isDesktop = typeof window !== "undefined" && window.desktopBridge !== undefined;
  return { isDesktop, isWeb: !isDesktop, ...options?.context };
};

function evaluateWhen(node: KeybindingWhenNode, context: ShortcutMatchContext): boolean {
  switch (node.type) {
    case "identifier":
      return node.name === "true" ? true : node.name === "false" ? false : !!context[node.name];
    case "not":
      return !evaluateWhen(node.node, context);
    case "and":
      return evaluateWhen(node.left, context) && evaluateWhen(node.right, context);
    case "or":
      return evaluateWhen(node.left, context) || evaluateWhen(node.right, context);
  }
}

/** The command the key press runs, or null; the last matching rule wins. */
export function resolveShortcutCommand(
  event: ShortcutEventLike,
  config: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): KeybindingCommand | null {
  const platform = platformOf(options);
  const context = contextOf(options);
  for (let index = config.length - 1; index >= 0; index -= 1) {
    const binding = config[index]!;
    if (binding.whenAst !== undefined && !evaluateWhen(binding.whenAst, context)) continue;
    if (matchesKeybindingShortcut(event, binding.shortcut, platform)) return binding.command;
  }
  return null;
}

const keyLabel = (key: string): string => {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  if (key === "escape") return "Esc";
  if (key.startsWith("arrow"))
    return (
      key.slice("arrow".length, "arrow".length + 1).toUpperCase() + key.slice("arrow".length + 1)
    );
  return key.slice(0, 1).toUpperCase() + key.slice(1);
};

/** `⇧⌘S` on a Mac, `Ctrl+Shift+S` elsewhere (T3 Code's `formatShortcutLabel`). */
function formatShortcutLabel(shortcut: KeybindingShortcut, platform: string): string {
  const mac = isMacPlatform(platform);
  const meta = shortcut.metaKey || (shortcut.modKey && mac);
  const ctrl = shortcut.ctrlKey || (shortcut.modKey && !mac);
  if (mac) {
    return `${ctrl ? "⌃" : ""}${shortcut.altKey ? "⌥" : ""}${shortcut.shiftKey ? "⇧" : ""}${meta ? "⌘" : ""}${keyLabel(shortcut.key)}`;
  }
  return [
    ...(ctrl ? ["Ctrl"] : []),
    ...(shortcut.altKey ? ["Alt"] : []),
    ...(shortcut.shiftKey ? ["Shift"] : []),
    ...(meta ? ["Meta"] : []),
    keyLabel(shortcut.key),
  ].join("+");
}

/** The keys a shortcut presses, with `mod` resolved for the platform. */
function shortcutConflictKey(shortcut: KeybindingShortcut, platform: string): string {
  const mac = isMacPlatform(platform);
  return [
    shortcut.key,
    shortcut.metaKey || (shortcut.modKey && mac) ? "meta" : "",
    shortcut.ctrlKey || (shortcut.modKey && !mac) ? "ctrl" : "",
    shortcut.shiftKey ? "shift" : "",
    shortcut.altKey ? "alt" : "",
  ].join("|");
}

/**
 * The shortcut that runs the command where the context holds: the last of
 * its rules whose `when` applies and whose keys no later applying rule
 * takes (T3 Code's `findEffectiveShortcutForCommand`).
 */
function effectiveShortcutForCommand(
  config: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  platform: string,
  context: ShortcutMatchContext,
): KeybindingShortcut | null {
  const claimed = new Set<string>();
  for (let index = config.length - 1; index >= 0; index -= 1) {
    const binding = config[index]!;
    if (binding.whenAst !== undefined && !evaluateWhen(binding.whenAst, context)) continue;
    const conflictKey = shortcutConflictKey(binding.shortcut, platform);
    if (claimed.has(conflictKey)) continue;
    claimed.add(conflictKey);
    if (binding.command === command) return binding.shortcut;
  }
  return null;
}

/** The label of the shortcut that runs the command, or null when none does. */
export function shortcutLabelForCommand(
  config: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  platform: string = navigator.platform,
  context?: ShortcutMatchContext,
): string | null {
  const shortcut = effectiveShortcutForCommand(
    config,
    command,
    platform,
    contextOf(context === undefined ? undefined : { context }),
  );
  return shortcut === null ? null : formatShortcutLabel(shortcut, platform);
}

/** The jump for a position in the sidebar, or null past the ninth (T3 Code's). */
export function threadJumpCommandForIndex(index: number): ThreadJumpKeybindingCommand | null {
  return THREAD_JUMP_KEYBINDING_COMMANDS[index] ?? null;
}

/** The sidebar position a jump goes to, or null for any other command. */
export function threadJumpIndexFromCommand(command: KeybindingCommand | null): number | null {
  const index = THREAD_JUMP_KEYBINDING_COMMANDS.indexOf(command as ThreadJumpKeybindingCommand);
  return index === -1 ? null : index;
}

export function threadTraversalDirectionFromCommand(
  command: KeybindingCommand | null,
): "previous" | "next" | null {
  return command === "thread.previous" ? "previous" : command === "thread.next" ? "next" : null;
}

/**
 * Whether the held modifiers are exactly a thread jump's, so the sidebar
 * shows each row's jump key (T3 Code's `shouldShowThreadJumpHintsForModifiers`).
 */
export function shouldShowThreadJumpHintsForModifiers(
  modifiers: ShortcutModifierStateLike,
  config: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  const platform = platformOf(options);
  const context = contextOf(options);
  return THREAD_JUMP_KEYBINDING_COMMANDS.some((command) => {
    const shortcut = effectiveShortcutForCommand(config, command, platform, context);
    return shortcut !== null && matchesKeybindingShortcutModifiers(modifiers, shortcut, platform);
  });
}

/** Whether a text field has focus, which `mod+z` leaves to the field (T3 Code's `isEditableFocused`). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement &&
      !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file"].includes(
        target.type,
      ))
  );
}

import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  isMacPlatform,
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  matchesKeybindingShortcut,
  type ResolvedKeybindingsConfig,
  type ShortcutEventLike,
} from "@playstead/shared/keybindings";

/**
 * Which command a key press runs, and how a command's shortcut is written
 * (T3 Code's `apps/web/src/keybindings.ts` at 2577baf, trimmed to the
 * resolver and labels). The page's bindings are the defaults until
 * **Settings → Keybindings** (slice 5) can change them.
 */

export const keybindings: ResolvedKeybindingsConfig = DEFAULT_RESOLVED_KEYBINDINGS;

/** What `when` clauses read; a name not given is false. */
export type ShortcutMatchContext = Readonly<Record<string, boolean>>;

interface ShortcutMatchOptions {
  readonly platform?: string;
  readonly context?: ShortcutMatchContext;
}

const platformOf = (options: ShortcutMatchOptions | undefined) =>
  options?.platform ?? navigator.platform;

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
  const context = options?.context ?? {};
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

/** The label of the shortcut that runs the command, or null when none does. */
export function shortcutLabelForCommand(
  config: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  platform: string = navigator.platform,
): string | null {
  for (let index = config.length - 1; index >= 0; index -= 1) {
    const binding = config[index]!;
    if (binding.command === command) return formatShortcutLabel(binding.shortcut, platform);
  }
  return null;
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

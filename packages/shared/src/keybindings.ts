/**
 * Keyboard shortcuts (T3 Code's `packages/shared/src/keybindings.ts` and the
 * types in `packages/contracts/src/keybindings.ts` at 2577baf): a rule names
 * a command, a key such as `mod+shift+s`, and an optional `when` clause over
 * the focus. `mod` is Command on a Mac and Control elsewhere. Only the
 * commands Playstead handles have default bindings; the others arrive with
 * their features, and editing them (**Settings → Keybindings**) with slice 5.
 */

/** The commands with shortcuts so far. */
export type KeybindingCommand = "sidebar.toggle" | "thread.settle" | "thread.pin" | "thread.undo";

export interface KeybindingRule {
  readonly key: string;
  readonly command: KeybindingCommand;
  readonly when?: string;
}

export interface KeybindingShortcut {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  /** Command on a Mac, Control elsewhere. */
  readonly modKey: boolean;
}

export type KeybindingWhenNode =
  | { readonly type: "identifier"; readonly name: string }
  | { readonly type: "not"; readonly node: KeybindingWhenNode }
  | { readonly type: "and"; readonly left: KeybindingWhenNode; readonly right: KeybindingWhenNode }
  | { readonly type: "or"; readonly left: KeybindingWhenNode; readonly right: KeybindingWhenNode };

export interface ResolvedKeybindingRule {
  readonly command: KeybindingCommand;
  readonly shortcut: KeybindingShortcut;
  readonly whenAst?: KeybindingWhenNode;
}

/** Later rules win over earlier ones, as T3 Code reads them. */
export type ResolvedKeybindingsConfig = ReadonlyArray<ResolvedKeybindingRule>;

const MAX_WHEN_EXPRESSION_DEPTH = 64;

export interface ShortcutEventLike {
  readonly key: string;
  readonly code?: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly getModifierState?: (key: "AltGraph") => boolean;
}

/** The keys a physical key stands for whatever the layout, by `KeyboardEvent.code`. */
const SHORTCUT_KEY_BY_CODE: Readonly<Record<string, string>> = {
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Digit0: "0",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",
  Equal: "=",
  Minus: "-",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
};

export const isMacPlatform = (platform: string): boolean => /mac|iphone|ipad|ipod/i.test(platform);

const normalizeEventKey = (key: string): string => {
  const lower = key.toLowerCase();
  return lower === "esc" ? "escape" : lower;
};

/**
 * Every key the event could mean: what the layout typed, and for a letter or
 * symbol key the key printed on a US keyboard, so `mod+z` works on a
 * Russian or German layout too (T3 Code's `resolveEventKeys`).
 */
function eventKeys(event: ShortcutEventLike): ReadonlySet<string> {
  const typed = normalizeEventKey(event.key);
  const keys = new Set([typed]);
  const letter = event.code?.match(/^Key([A-Z])$/)?.[1];
  if (letter !== undefined && !/^[a-z]$/.test(typed)) keys.add(letter.toLowerCase());
  if (!/^[a-z]$/.test(typed)) {
    const physical = event.code === undefined ? undefined : SHORTCUT_KEY_BY_CODE[event.code];
    if (physical !== undefined) keys.add(physical);
  }
  return keys;
}

export function matchesKeybindingShortcut(
  event: ShortcutEventLike,
  shortcut: KeybindingShortcut,
  platform: string,
): boolean {
  const mac = isMacPlatform(platform);
  // AltGr types symbols on Windows and Linux layouts; it is not a shortcut.
  if (!mac && event.getModifierState?.("AltGraph") === true && !/^[a-z0-9]$/i.test(event.key)) {
    return false;
  }
  const expectsMeta = shortcut.metaKey || (shortcut.modKey && mac);
  const expectsCtrl = shortcut.ctrlKey || (shortcut.modKey && !mac);
  return (
    event.metaKey === expectsMeta &&
    event.ctrlKey === expectsCtrl &&
    event.shiftKey === shortcut.shiftKey &&
    event.altKey === shortcut.altKey &&
    eventKeys(event).has(shortcut.key)
  );
}

/** Reads `mod+shift+s`, or null when it is not a shortcut. */
function parseKeybindingShortcut(value: string): KeybindingShortcut | null {
  const tokens = value
    .toLowerCase()
    .split("+")
    .map((token) => token.trim());
  // `mod++` binds the plus key itself.
  let trailingEmpty = 0;
  while (tokens.at(-1) === "") {
    tokens.pop();
    trailingEmpty += 1;
  }
  if (trailingEmpty > 0) tokens.push("+");
  if (tokens.length === 0 || tokens.some((token) => token.length === 0)) return null;

  let key: string | null = null;
  const shortcut = {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    modKey: false,
  };
  for (const token of tokens) {
    if (token === "cmd" || token === "meta") shortcut.metaKey = true;
    else if (token === "ctrl" || token === "control") shortcut.ctrlKey = true;
    else if (token === "shift") shortcut.shiftKey = true;
    else if (token === "alt" || token === "option") shortcut.altKey = true;
    else if (token === "mod") shortcut.modKey = true;
    else {
      if (key !== null) return null;
      key = token === "space" ? " " : token === "esc" ? "escape" : token;
    }
  }
  return key === null ? null : { key, ...shortcut };
}

type WhenToken =
  | { readonly type: "identifier"; readonly value: string }
  | { readonly type: "not" | "and" | "or" | "lparen" | "rparen" };

function tokenizeWhen(expression: string): ReadonlyArray<WhenToken> | null {
  const tokens: Array<WhenToken> = [];
  let index = 0;
  while (index < expression.length) {
    const rest = expression.slice(index);
    if (/^\s/.test(rest)) {
      index += 1;
    } else if (rest.startsWith("&&")) {
      tokens.push({ type: "and" });
      index += 2;
    } else if (rest.startsWith("||")) {
      tokens.push({ type: "or" });
      index += 2;
    } else if (rest.startsWith("!")) {
      tokens.push({ type: "not" });
      index += 1;
    } else if (rest.startsWith("(")) {
      tokens.push({ type: "lparen" });
      index += 1;
    } else if (rest.startsWith(")")) {
      tokens.push({ type: "rparen" });
      index += 1;
    } else {
      const identifier = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(rest)?.[0];
      if (identifier === undefined) return null;
      tokens.push({ type: "identifier", value: identifier });
      index += identifier.length;
    }
  }
  return tokens;
}

/** Reads a `when` clause such as `!terminalFocus && !editableFocus`: `!`, `&&`, `||` and parentheses. */
function parseKeybindingWhenExpression(expression: string): KeybindingWhenNode | null {
  const tokens = tokenizeWhen(expression);
  if (tokens === null || tokens.length === 0) return null;
  let index = 0;

  const primary = (depth: number): KeybindingWhenNode | null => {
    if (depth > MAX_WHEN_EXPRESSION_DEPTH) return null;
    const token = tokens[index];
    if (token?.type === "identifier") {
      index += 1;
      return { type: "identifier", name: token.value };
    }
    if (token?.type !== "lparen") return null;
    index += 1;
    const inner = or(depth + 1);
    if (inner === null || tokens[index]?.type !== "rparen") return null;
    index += 1;
    return inner;
  };
  const unary = (depth: number): KeybindingWhenNode | null => {
    let nots = 0;
    while (tokens[index]?.type === "not") {
      index += 1;
      nots += 1;
      if (nots > MAX_WHEN_EXPRESSION_DEPTH) return null;
    }
    let node = primary(depth);
    for (; node !== null && nots > 0; nots -= 1) node = { type: "not", node };
    return node;
  };
  const and = (depth: number): KeybindingWhenNode | null => {
    let left = unary(depth);
    while (left !== null && tokens[index]?.type === "and") {
      index += 1;
      const right = unary(depth);
      left = right === null ? null : { type: "and", left, right };
    }
    return left;
  };
  const or = (depth: number): KeybindingWhenNode | null => {
    let left = and(depth);
    while (left !== null && tokens[index]?.type === "or") {
      index += 1;
      const right = and(depth);
      left = right === null ? null : { type: "or", left, right };
    }
    return left;
  };

  const tree = or(0);
  return tree !== null && index === tokens.length ? tree : null;
}

/** Compiles rules, leaving out any whose key or `when` clause cannot be read. */
function compileResolvedKeybindingsConfig(
  rules: ReadonlyArray<KeybindingRule>,
): ResolvedKeybindingsConfig {
  return rules.flatMap((rule) => {
    const shortcut = parseKeybindingShortcut(rule.key);
    if (shortcut === null) return [];
    if (rule.when === undefined) return [{ command: rule.command, shortcut }];
    const whenAst = parseKeybindingWhenExpression(rule.when);
    return whenAst === null ? [] : [{ command: rule.command, shortcut, whenAst }];
  });
}

/** T3 Code's default bindings, for the commands Playstead has. */
const DEFAULT_KEYBINDINGS: ReadonlyArray<KeybindingRule> = [
  { key: "mod+b", command: "sidebar.toggle" },
  { key: "mod+shift+s", command: "thread.settle", when: "!terminalFocus" },
  { key: "mod+shift+p", command: "thread.pin", when: "!terminalFocus" },
  { key: "mod+z", command: "thread.undo", when: "!terminalFocus && !editableFocus" },
];

export const DEFAULT_RESOLVED_KEYBINDINGS = compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS);

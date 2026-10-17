/**
 * Opens the command palette from anywhere on the page, as T3 Code's
 * `apps/web/src/commandPaletteBus.ts` at 2577baf does: at its root, or
 * straight into **Add project** or **New thread in…**.
 */

export interface CommandPaletteOpenDetail {
  readonly open?: "add-project" | "new-thread-in";
}

const OPEN_COMMAND_PALETTE_EVENT = "playstead:open-command-palette";

export function openCommandPalette(detail: CommandPaletteOpenDetail = {}): void {
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT, { detail }));
}

export function onOpenCommandPalette(
  listener: (detail: CommandPaletteOpenDetail) => void,
): () => void {
  const handle = (event: Event) =>
    listener((event as CustomEvent<CommandPaletteOpenDetail | null>).detail ?? {});
  window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handle);
  return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handle);
}

/** While it is open the page's own shortcuts stand aside (T3 Code's `isCommandPaletteOpen`). */
export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  );
}

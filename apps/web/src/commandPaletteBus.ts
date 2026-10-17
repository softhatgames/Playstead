/**
 * Opens the command palette from anywhere on the page, as T3 Code's
 * `apps/web/src/commandPaletteBus.ts` at 2577baf does.
 */

export interface OpenCommandPaletteRequest {
  readonly open: "root" | "new-thread-in" | "add-project";
}

const OPEN_COMMAND_PALETTE_EVENT = "playstead:open-command-palette";

export function openCommandPalette(request: OpenCommandPaletteRequest): void {
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT, { detail: request }));
}

export function onOpenCommandPalette(
  listener: (request: OpenCommandPaletteRequest) => void,
): () => void {
  const handle = (event: Event) =>
    listener((event as CustomEvent<OpenCommandPaletteRequest>).detail);
  window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handle);
  return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handle);
}

let paletteOpen = false;
export const isCommandPaletteOpen = () => paletteOpen;
export function setCommandPaletteOpen(open: boolean): void {
  paletteOpen = open;
}

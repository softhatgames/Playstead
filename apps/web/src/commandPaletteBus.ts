/**
 * Opens the command palette from anywhere on the page, as T3 Code's
 * `apps/web/src/commandPaletteBus.ts` at 2577baf does. Add project is the
 * palette's only mode.
 */

export interface OpenCommandPaletteRequest {
  readonly open: "add-project";
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

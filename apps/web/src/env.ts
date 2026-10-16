import type { DesktopBridge } from "@playstead/contracts/ipc";

declare global {
  interface Window {
    /** Present in the desktop app's window, from its preload (T3 Code's `apps/web/src/env.ts`). */
    readonly desktopBridge?: DesktopBridge;
  }
}

export const desktopBridge: DesktopBridge | undefined = window.desktopBridge;

export const isElectron = desktopBridge !== undefined;

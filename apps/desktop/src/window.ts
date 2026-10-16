import { BrowserWindow, nativeTheme, shell } from "electron";

import type { DesktopEnvironment } from "./app/DesktopEnvironment.ts";

/** Only web and mail links leave the app, in the system's own handler. */
export const parseSafeExternalUrl = (raw: string): string | undefined => {
  const url = URL.parse(raw);
  return url !== null && ["http:", "https:", "mailto:"].includes(url.protocol)
    ? url.toString()
    : undefined;
};

const openExternally = (raw: string) => {
  const url = parseSafeExternalUrl(raw);
  if (url !== undefined) void shell.openExternal(url);
};

/**
 * The main window, as T3 Code's `apps/desktop/src/window/DesktopWindow.ts`
 * makes it: hidden until its first paint, sandboxed, with the bridge's
 * preload, and every link that leaves the interface sent to the browser.
 */
export const createMainWindow = (environment: DesktopEnvironment): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 840,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    title: environment.displayName,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    ...(process.platform === "darwin"
      ? {}
      : {
          icon:
            process.platform === "win32" ? environment.iconPaths.ico : environment.iconPaths.png,
        }),
    webPreferences: {
      preload: environment.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(environment.windowUrl)) return;
    event.preventDefault();
    openExternally(url);
  });
  // The interface sets its own title; the window keeps the app's name.
  window.on("page-title-updated", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  void window.loadURL(environment.windowUrl);
  return window;
};

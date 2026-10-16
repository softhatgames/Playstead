/**
 * The bridge the window's interface sees as `window.desktopBridge`, with
 * T3 Code's core methods only (`apps/desktop/src/preload.ts`). The window is
 * sandboxed, so this file is bundled on its own and reaches the main process
 * through IPC alone.
 */
import type { DesktopBridge } from "@playstead/contracts/ipc";
import { contextBridge, ipcRenderer } from "electron";

import { IpcChannels } from "./ipc/channels.ts";

const bridge: DesktopBridge = {
  getAppBranding: () => ipcRenderer.sendSync(IpcChannels.getAppBranding),
  getClientPlatform: () => process.platform,
  getLocalEnvironmentBootstraps: () =>
    ipcRenderer.sendSync(IpcChannels.getLocalEnvironmentBootstraps),
  getLocalEnvironmentBearerToken: () =>
    ipcRenderer.invoke(IpcChannels.getLocalEnvironmentBearerToken),
  getClientSettings: () => ipcRenderer.invoke(IpcChannels.getClientSettings),
  setClientSettings: (settings) => ipcRenderer.invoke(IpcChannels.setClientSettings, settings),
  pickFolder: (options) => ipcRenderer.invoke(IpcChannels.pickFolder, options),
  setTheme: (theme) => ipcRenderer.invoke(IpcChannels.setTheme, theme),
  openExternal: (url) => ipcRenderer.invoke(IpcChannels.openExternal, url),
};

contextBridge.exposeInMainWorld("desktopBridge", bridge);

/**
 * The bridge's IPC channels, shared by the preload and the main process.
 * T3 Code's are in `apps/desktop/src/ipc/channels.ts`; Playstead's prefix is
 * its own.
 */
export const IpcChannels = {
  getAppBranding: "playstead:get-app-branding",
  getLocalEnvironmentBootstraps: "playstead:get-local-environment-bootstraps",
  getLocalEnvironmentBearerToken: "playstead:get-local-environment-bearer-token",
  getClientSettings: "playstead:get-client-settings",
  setClientSettings: "playstead:set-client-settings",
  pickFolder: "playstead:pick-folder",
  setTheme: "playstead:set-theme",
  openExternal: "playstead:open-external",
  showContextMenu: "playstead:show-context-menu",
} as const;

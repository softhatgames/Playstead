// @effect-diagnostics nodeBuiltinImport:off -- The client settings file is read and written with plain Node.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  ClientSettings,
  ContextMenuItemSchema,
  ContextMenuPosition,
  DesktopTheme,
  type DesktopAppBranding,
  type DesktopEnvironmentBootstrap,
  PickFolderOptions,
} from "@playstead/contracts/ipc";
import { identity } from "@playstead/shared/identity";
import * as Schema from "effect/Schema";
import { BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";

import type { DesktopEnvironment } from "../app/DesktopEnvironment.ts";
import { showNativeContextMenu } from "../electron/contextMenu.ts";
import { parseSafeExternalUrl } from "../window.ts";
import { IpcChannels } from "./channels.ts";

const decodeClientSettings = Schema.decodeUnknownSync(Schema.fromJsonString(ClientSettings));
const encodeClientSettings = Schema.encodeSync(Schema.fromJsonString(ClientSettings));
const decodeTheme = Schema.decodeUnknownSync(DesktopTheme);
const decodePickFolderOptions = Schema.decodeUnknownSync(Schema.UndefinedOr(PickFolderOptions));
const decodeUrl = Schema.decodeUnknownSync(Schema.String);
const decodeContextMenuItems = Schema.decodeUnknownSync(Schema.Array(ContextMenuItemSchema));
const decodeContextMenuPosition = Schema.decodeUnknownSync(Schema.UndefinedOr(ContextMenuPosition));

export interface DesktopIpcContext {
  readonly environment: DesktopEnvironment;
  readonly bootstraps: () => ReadonlyArray<DesktopEnvironmentBootstrap>;
  readonly bearerToken: () => Promise<string>;
}

const readClientSettings = (path: string): ClientSettings | null => {
  try {
    return decodeClientSettings(NodeFS.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/** Written beside itself and renamed, so a crash never leaves half a file. */
const writeClientSettings = (path: string, settings: ClientSettings) => {
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temporary, `${encodeClientSettings(settings)}\n`);
  NodeFS.renameSync(temporary, path);
};

/**
 * The main process's side of the bridge. Every payload from the window is
 * checked against its schema first, as T3 Code's `DesktopIpc.makeIpcMethod`
 * does (`apps/desktop/src/ipc/DesktopIpc.ts`, `ipc/methods/*.ts`).
 */
export const installIpcHandlers = (context: DesktopIpcContext) => {
  const { environment } = context;
  const branding: DesktopAppBranding = {
    baseName: identity.productName.production,
    stageLabel: environment.isDevelopment ? "Dev" : null,
    displayName: environment.displayName,
  };

  ipcMain.on(IpcChannels.getAppBranding, (event) => {
    event.returnValue = branding;
  });
  ipcMain.on(IpcChannels.getLocalEnvironmentBootstraps, (event) => {
    event.returnValue = context.bootstraps();
  });
  ipcMain.handle(IpcChannels.getLocalEnvironmentBearerToken, () => context.bearerToken());
  ipcMain.handle(IpcChannels.getClientSettings, () =>
    readClientSettings(environment.clientSettingsPath),
  );
  ipcMain.handle(IpcChannels.setClientSettings, (_event, settings: unknown) =>
    writeClientSettings(
      environment.clientSettingsPath,
      decodeClientSettings(JSON.stringify(settings)),
    ),
  );
  ipcMain.handle(IpcChannels.pickFolder, async (event, options: unknown) => {
    const { initialPath } = decodePickFolderOptions(options) ?? {};
    const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      ...(initialPath === undefined ? {} : { defaultPath: initialPath }),
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(IpcChannels.setTheme, (_event, theme: unknown) => {
    nativeTheme.themeSource = decodeTheme(theme);
  });
  ipcMain.handle(IpcChannels.showContextMenu, async (event, items: unknown, position: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null) return null;
    return showNativeContextMenu({
      window,
      items: decodeContextMenuItems(items),
      position: decodeContextMenuPosition(position),
    });
  });
  ipcMain.handle(IpcChannels.openExternal, async (_event, raw: unknown) => {
    const url = parseSafeExternalUrl(decodeUrl(raw));
    if (url === undefined) return false;
    await shell.openExternal(url);
    return true;
  });
};

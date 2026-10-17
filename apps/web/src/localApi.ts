import type {
  ClientSettings,
  ContextMenuItem,
  ContextMenuPosition,
} from "@playstead/contracts/ipc";

import {
  readBrowserClientSettings,
  writeBrowserClientSettings,
} from "./clientPersistenceStorage.ts";
import { type ConfirmDialogOptions, requestConfirmDialog } from "./confirmDialog.ts";
import { dismissContextMenu, showContextMenuFallback } from "./contextMenuFallback.ts";
import { desktopBridge } from "./env.ts";

/**
 * What the interface asks of the computer it runs on, the same in the
 * desktop app and a browser (T3 Code's `apps/web/src/localApi.ts` at
 * 2577baf): context menus are native in the desktop app and drawn by the
 * interface in a browser; confirmations are the interface's own dialog in
 * both, as in T3 Code; client settings live with the desktop app or in the
 * browser's storage.
 */
export interface LocalApi {
  readonly contextMenu: {
    readonly show: <T extends string>(
      items: ReadonlyArray<ContextMenuItem<T>>,
      position?: ContextMenuPosition,
    ) => Promise<T | null>;
    /** Closes the interface's own menu; a native one closes by itself. */
    readonly close: () => void;
  };
  readonly dialogs: {
    readonly confirm: (message: string, options?: ConfirmDialogOptions) => Promise<boolean>;
  };
  readonly persistence: {
    readonly getClientSettings: () => Promise<ClientSettings | null>;
    readonly setClientSettings: (settings: ClientSettings) => Promise<void>;
  };
}

const localApi: LocalApi = {
  contextMenu: {
    show: (items, position) =>
      desktopBridge === undefined
        ? showContextMenuFallback(items, position)
        : desktopBridge.showContextMenu(items, position),
    close: () => {
      if (desktopBridge === undefined) dismissContextMenu();
    },
  },
  dialogs: { confirm: requestConfirmDialog },
  persistence: {
    getClientSettings: () =>
      desktopBridge === undefined
        ? Promise.resolve(readBrowserClientSettings())
        : desktopBridge.getClientSettings(),
    setClientSettings: (settings) => {
      if (desktopBridge !== undefined) return desktopBridge.setClientSettings(settings);
      writeBrowserClientSettings(settings);
      return Promise.resolve();
    },
  },
};

export const readLocalApi = (): LocalApi => localApi;

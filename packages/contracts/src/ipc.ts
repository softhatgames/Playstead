import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * The desktop bridge: what the desktop app adds to the interface in its
 * window, as `window.desktopBridge`. It has T3 Code's core methods only
 * (`packages/contracts/src/ipc.ts`, `DesktopBridge`); SSH, Tailscale, WSL,
 * preview, snap-shot, updates and the rest are absent.
 */

export const DesktopTheme = Schema.Literals(["light", "dark", "system"]);
export type DesktopTheme = typeof DesktopTheme.Type;

export interface DesktopAppBranding {
  readonly baseName: string;
  readonly stageLabel: "Dev" | null;
  readonly displayName: string;
}

/** The id of the desktop app's own server among the window's environments. */
export const PRIMARY_LOCAL_ENVIRONMENT_ID = "primary";

export interface DesktopEnvironmentBootstrap {
  readonly id: string;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

/**
 * The interface's settings that live with the client rather than the server
 * (T3 Code's `ClientSettingsSchema`, `packages/contracts/src/settings.ts` at
 * 2577baf): in the desktop app's `client-settings.json`, in a browser's
 * localStorage. Each arrives with the feature that uses it, with T3 Code's
 * default, which a file written before it decodes to.
 */
export const ClientSettings = Schema.Struct({
  /** Ask before archiving a thread. */
  confirmThreadArchive: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** Ask before deleting a thread. */
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type ClientSettings = typeof ClientSettings.Type;

/** Every client setting at its default. */
export const DEFAULT_CLIENT_SETTINGS: ClientSettings = Schema.decodeUnknownSync(ClientSettings)({});

/**
 * One entry of a context menu (T3 Code's `ContextMenuItem`): the desktop app
 * shows it as a native menu, a browser as the interface's own. A header is
 * a label the native menu leaves out; `children` make a submenu.
 */
export interface ContextMenuItem<T extends string = string> {
  readonly id: T;
  readonly label: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly header?: boolean;
  readonly separatorBefore?: boolean;
  readonly checked?: boolean;
  readonly children?: ReadonlyArray<ContextMenuItem<T>>;
}

interface ContextMenuItemEncoded {
  readonly id: string;
  readonly label: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly header?: boolean;
  readonly separatorBefore?: boolean;
  readonly checked?: boolean;
  readonly children?: ReadonlyArray<ContextMenuItemEncoded>;
}

/** What the desktop app checks a menu from the window against. */
export const ContextMenuItemSchema: Schema.Codec<ContextMenuItemEncoded> = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  destructive: Schema.optionalKey(Schema.Boolean),
  disabled: Schema.optionalKey(Schema.Boolean),
  header: Schema.optionalKey(Schema.Boolean),
  separatorBefore: Schema.optionalKey(Schema.Boolean),
  checked: Schema.optionalKey(Schema.Boolean),
  children: Schema.optionalKey(
    Schema.Array(Schema.suspend((): Schema.Codec<ContextMenuItemEncoded> => ContextMenuItemSchema)),
  ),
});

/** Where a context menu opens, in the window's CSS pixels. */
export const ContextMenuPosition = Schema.Struct({ x: Schema.Number, y: Schema.Number });
export type ContextMenuPosition = typeof ContextMenuPosition.Type;

export const PickFolderOptions = Schema.Struct({
  initialPath: Schema.optionalKey(Schema.String),
});
export type PickFolderOptions = typeof PickFolderOptions.Type;

export interface DesktopBridge {
  readonly getAppBranding: () => DesktopAppBranding;
  readonly getClientPlatform: () => string;
  readonly getLocalEnvironmentBootstraps: () => ReadonlyArray<DesktopEnvironmentBootstrap>;
  readonly getLocalEnvironmentBearerToken: () => Promise<string>;
  readonly getClientSettings: () => Promise<ClientSettings | null>;
  readonly setClientSettings: (settings: ClientSettings) => Promise<void>;
  readonly pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
  readonly setTheme: (theme: DesktopTheme) => Promise<void>;
  readonly openExternal: (url: string) => Promise<boolean>;
  /** Shows a native context menu and resolves with the chosen item's id, or null. */
  readonly showContextMenu: <T extends string>(
    items: ReadonlyArray<ContextMenuItem<T>>,
    position?: ContextMenuPosition,
  ) => Promise<T | null>;
}

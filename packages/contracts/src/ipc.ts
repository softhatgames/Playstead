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
 * The interface's settings that live with the desktop app rather than the
 * server. The slice has none yet; each arrives with the feature that uses it.
 */
export const ClientSettings = Schema.Struct({});
export type ClientSettings = typeof ClientSettings.Type;

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
}

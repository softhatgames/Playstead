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
 * What Enter does while a run is active (T3 Code's `followUpBehavior` in
 * `packages/contracts/src/settings.ts` at 2577baf). Playstead has queueing
 * so far; steering adds `steer`.
 */
export const FollowUpBehavior = Schema.Literals(["queue"]);
export type FollowUpBehavior = typeof FollowUpBehavior.Type;

/**
 * The interface's settings that live with the client rather than the server
 * (T3 Code's `ClientSettingsSchema`, `packages/contracts/src/settings.ts` at
 * 2577baf): in the desktop app's `client-settings.json`, in a browser's
 * localStorage. Each arrives with the feature that uses it, with T3 Code's
 * default, which a file written before it decodes to.
 */
export const ClientSettings = Schema.Struct({
  followUpBehavior: FollowUpBehavior.pipe(Schema.withDecodingDefault(Effect.succeed("queue"))),
});
export type ClientSettings = typeof ClientSettings.Type;

/** Every client setting at its default. */
export const DEFAULT_CLIENT_SETTINGS: ClientSettings = Schema.decodeUnknownSync(ClientSettings)({});

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

import { identity } from "@playstead/shared/identity";
import * as Path from "effect/Path";

const variable = (name: string) => `${identity.environmentVariablePrefix}${name}`;

/** The variables the desktop app reads. The development runner sets them. */
const DesktopEnvironmentVariables = {
  home: identity.home.variable,
  /** The server's port; required in development, as T3 Code requires `T3CODE_PORT`. */
  port: variable("PORT"),
  /** Vite's address. Its presence means development, as `VITE_DEV_SERVER_URL` does in T3 Code. */
  devUrl: variable("DEV_URL"),
} as const;

/** Where a packaged app's server listens, when that port is free: the server's own default. */
export const DEFAULT_BACKEND_PORT = 4773;

export interface DesktopEnvironment {
  readonly isDevelopment: boolean;
  readonly displayName: string;
  readonly appId: string;
  readonly urlScheme: string;
  readonly windowUrl: string;
  readonly devUrl: string | undefined;
  /** Set in development; a packaged app picks a free port. */
  readonly backendPort: number | undefined;
  readonly playsteadHome: string;
  readonly userDataPath: string;
  readonly clientSettingsPath: string;
  readonly backendEntryPath: string;
  readonly clientAssetsDir: string;
  readonly preloadPath: string;
  /** The exported icon files (`scripts/export-icons.ts`). */
  readonly iconPaths: { readonly png: string; readonly macPng: string; readonly ico: string };
}

export interface DesktopEnvironmentInput {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory: string;
  /** `%APPDATA%`, `~/Library/Application Support` or the XDG config folder. */
  readonly appDataDirectory: string;
  /** `apps/desktop`, the folder above `dist-electron/`. */
  readonly desktopDir: string;
  /** `--user-data-dir=<path>` keeps a smoke boot away from the person's own data. */
  readonly argv: ReadonlyArray<string>;
}

const nonEmpty = (value: string | undefined) =>
  value === undefined || value.trim().length === 0 ? undefined : value.trim();

const USER_DATA_FLAG = "--user-data-dir=";

/**
 * Everything the desktop app derives from where it runs: identity values for
 * development or not, the Playstead home and the files it uses. Follows
 * T3 Code's `apps/desktop/src/app/DesktopEnvironment.ts`, `DesktopConfig.ts`
 * and `DesktopUserData.ts`, with no legacy user-data migration.
 */
export const resolveDesktopEnvironment = (
  path: Path.Path,
  input: DesktopEnvironmentInput,
): DesktopEnvironment => {
  const devUrl = nonEmpty(input.env[DesktopEnvironmentVariables.devUrl]);
  const isDevelopment = devUrl !== undefined;
  const stage = isDevelopment ? "development" : "production";
  const port = Number(nonEmpty(input.env[DesktopEnvironmentVariables.port]));
  const configuredHome = nonEmpty(input.env[DesktopEnvironmentVariables.home]);
  const userDataFlag = input.argv.find((arg) => arg.startsWith(USER_DATA_FLAG));
  const userDataPath =
    userDataFlag !== undefined
      ? path.resolve(userDataFlag.slice(USER_DATA_FLAG.length))
      : path.join(input.appDataDirectory, identity.electronUserDataFolder[stage]);
  const repoRoot = path.join(input.desktopDir, "..", "..");
  const serverDist = path.join(repoRoot, "apps", "server", "dist");
  return {
    isDevelopment,
    displayName: identity.productName[stage],
    appId: identity.appId[stage],
    urlScheme: identity.urlScheme[stage],
    windowUrl: identity.windowUrl[stage],
    devUrl,
    backendPort: Number.isInteger(port) && port > 0 ? port : undefined,
    playsteadHome:
      configuredHome !== undefined
        ? path.resolve(configuredHome)
        : path.join(input.homeDirectory, identity.home.directoryName),
    userDataPath,
    clientSettingsPath: path.join(userDataPath, "client-settings.json"),
    backendEntryPath: path.join(serverDist, "bin.mjs"),
    clientAssetsDir: path.join(serverDist, "client"),
    preloadPath: path.join(input.desktopDir, "dist-electron", "preload.cjs"),
    iconPaths: {
      png: path.join(repoRoot, "assets", "icons", "playstead-universal-1024.png"),
      macPng: path.join(repoRoot, "assets", "icons", "playstead-macos-1024.png"),
      ico: path.join(repoRoot, "assets", "icons", "playstead-windows.ico"),
    },
  };
};

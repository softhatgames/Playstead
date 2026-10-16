import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { identity } from "@playstead/shared/identity";

import packageJson from "../package.json" with { type: "json" };

/** Where a server started without a port listens, when that port is free. */
const DEFAULT_PORT = 4773;

export const serverVersion = packageJson.version;

const variable = (name: string) => `${identity.environmentVariablePrefix}${name}`;

/** The variables the server reads. It reads no `T3CODE_*` variable. */
const ServerEnvironmentVariables = {
  home: identity.home.variable,
  port: variable("PORT"),
  devUrl: variable("DEV_URL"),
} as const;

export interface ServerDerivedPaths {
  readonly stateDir: string;
  readonly dbPath: string;
  readonly environmentIdPath: string;
  readonly secretsDir: string;
  readonly settingsPath: string;
}

export class ServerConfig extends Context.Service<
  ServerConfig,
  ServerDerivedPaths & {
    readonly cwd: string;
    /** The Playstead home. */
    readonly baseDir: string;
    /** `0` picks a free port, which tests use. */
    readonly port: number;
    /** Set in development, where Vite serves the interface. */
    readonly devUrl: URL | undefined;
    readonly staticDir: string | undefined;
    /** Handed over by the desktop app, which exchanges it for a bearer token. */
    readonly desktopBootstrapToken: string | undefined;
  }
>()("@playstead/server/config/ServerConfig") {}

/**
 * Development state goes under `dev/` and runtime state under `userdata/`.
 * Unlike T3 Code, whose explicit home always means `userdata/`, a home set by
 * the variable or by a worktree keeps development state apart from the
 * runtime database.
 */
export const deriveServerPaths = Effect.fn("deriveServerPaths")(function* (
  baseDir: string,
  devUrl: URL | undefined,
) {
  const { join } = yield* Path.Path;
  const stateDir = join(
    baseDir,
    devUrl === undefined
      ? identity.home.stateDirectoryName.production
      : identity.home.stateDirectoryName.development,
  );
  return {
    stateDir,
    dbPath: join(stateDir, "state.sqlite"),
    environmentIdPath: join(stateDir, "environment-id"),
    secretsDir: join(stateDir, "secrets"),
    settingsPath: join(stateDir, "settings.json"),
  } satisfies ServerDerivedPaths;
});

const ensureServerDirectories = Effect.fn("ensureServerDirectories")(function* (
  paths: ServerDerivedPaths,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(paths.stateDir, { recursive: true });
});

/** The interface's built files: bundled beside the server, or the web app's build. */
const resolveStaticDir = Effect.fn("resolveStaticDir")(function* () {
  const { join, resolve } = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  for (const candidate of [
    resolve(join(import.meta.dirname, "client")),
    resolve(join(import.meta.dirname, "../../web/dist")),
  ]) {
    const found = yield* fs
      .exists(join(candidate, "index.html"))
      .pipe(Effect.orElseSucceed(() => false));
    if (found) return candidate;
  }
  return undefined;
});

const optionalString = (name: string) =>
  Config.String(name).pipe(
    Config.option,
    Config.map((value) => Option.filter(value, (text) => text.trim().length > 0)),
    Config.map(Option.map((text) => text.trim())),
  );

/**
 * The home is `PLAYSTEAD_HOME`, or `~/.playstead`. The development runner sets
 * the variable to a worktree's own `.playstead`.
 */
const resolveBaseDir = Effect.fn("resolveBaseDir")(function* (
  configured: Option.Option<string>,
  homeDirectory: string,
) {
  const path = yield* Path.Path;
  return Option.isSome(configured)
    ? path.resolve(configured.value)
    : path.join(homeDirectory, identity.home.directoryName);
});

export const resolveServerConfig = Effect.fn("resolveServerConfig")(function* (input: {
  readonly cwd: string;
  readonly homeDirectory: string;
  readonly findPort: (preferred: number) => Effect.Effect<number>;
}) {
  const configuredHome = yield* optionalString(ServerEnvironmentVariables.home);
  const configuredPort = yield* Config.Port(ServerEnvironmentVariables.port).pipe(Config.option);
  const devUrl = yield* optionalString(ServerEnvironmentVariables.devUrl).pipe(
    Config.map(Option.map((value) => new URL(value))),
  );
  const baseDir = yield* resolveBaseDir(configuredHome, input.homeDirectory);
  const paths = yield* deriveServerPaths(baseDir, Option.getOrUndefined(devUrl));
  const port = Option.isSome(configuredPort)
    ? configuredPort.value
    : yield* input.findPort(DEFAULT_PORT);
  return ServerConfig.of({
    cwd: input.cwd,
    baseDir,
    ...paths,
    port,
    devUrl: Option.getOrUndefined(devUrl),
    staticDir: Option.isSome(devUrl) ? undefined : yield* resolveStaticDir(),
    desktopBootstrapToken: undefined,
  });
});

export const layer = (config: ServerConfig["Service"]) =>
  Layer.effect(
    ServerConfig,
    ensureServerDirectories(config).pipe(Effect.as(ServerConfig.of(config))),
  );

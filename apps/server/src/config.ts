import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import type { DesktopBackendBootstrap } from "@playstead/contracts/desktopBootstrap";
import { identity } from "@playstead/shared/identity";

import packageJson from "../package.json" with { type: "json" };
import { readBootstrapEnvelope } from "./bootstrap.ts";

/** Where a server started without a port listens, when that port is free. */
const DEFAULT_PORT = 4773;

export const serverVersion = packageJson.version;

const variable = (name: string) => `${identity.environmentVariablePrefix}${name}`;

/** The variables the server reads. It reads no `T3CODE_*` variable. */
const ServerEnvironmentVariables = {
  home: identity.home.variable,
  port: variable("PORT"),
  devUrl: variable("DEV_URL"),
  /** The file descriptor the desktop app writes its settings to. */
  bootstrapFd: variable("BOOTSTRAP_FD"),
} as const;

export interface ServerDerivedPaths {
  readonly stateDir: string;
  readonly dbPath: string;
  readonly environmentIdPath: string;
  readonly secretsDir: string;
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
 * The home is `PLAYSTEAD_HOME`, the desktop app's, or `~/.playstead`. The
 * development runner sets the variable to a worktree's own `.playstead`.
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
  // As in T3 Code's `apps/server/src/cli/config.ts`, a variable wins over the
  // desktop app's settings.
  const bootstrapFd = yield* Config.Int(ServerEnvironmentVariables.bootstrapFd).pipe(Config.option);
  const bootstrap = Option.isSome(bootstrapFd)
    ? yield* readBootstrapEnvelope(bootstrapFd.value)
    : Option.none();
  const fromBootstrap = <A>(read: (envelope: DesktopBackendBootstrap) => A | undefined) =>
    Option.flatMap(bootstrap, (envelope) => Option.fromUndefinedOr(read(envelope)));
  const configuredHome = Option.orElse(yield* optionalString(ServerEnvironmentVariables.home), () =>
    fromBootstrap((envelope) => envelope.playsteadHome),
  );
  const configuredPort = Option.orElse(
    yield* Config.Port(ServerEnvironmentVariables.port).pipe(Config.option),
    () => fromBootstrap((envelope) => envelope.port),
  );
  const devUrl = Option.orElse(yield* optionalString(ServerEnvironmentVariables.devUrl), () =>
    fromBootstrap((envelope) => envelope.devUrl),
  ).pipe(Option.map((value) => new URL(value)));
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
    desktopBootstrapToken: Option.getOrUndefined(
      fromBootstrap((envelope) => envelope.desktopBootstrapToken),
    ),
  });
});

export const layer = (config: ServerConfig["Service"]) =>
  Layer.effect(
    ServerConfig,
    ensureServerDirectories(config).pipe(Effect.as(ServerConfig.of(config))),
  );

// @effect-diagnostics nodeBuiltinImport:off -- Effect has no host name or platform service.
import * as NodeOS from "node:os";

import { EnvironmentId } from "@playstead/contracts/baseSchemas";
import type { ExecutionEnvironmentDescriptor } from "@playstead/contracts/environment";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

class ServerEnvironmentIdPersistenceError extends Schema.TaggedError<ServerEnvironmentIdPersistenceError>()(
  "ServerEnvironmentIdPersistenceError",
  { environmentIdPath: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read or write the environment id at '${this.environmentIdPath}'.`;
  }
}

/** This server's environment: a stable id kept in the Playstead home, and its descriptor. */
export class ServerEnvironment extends Context.Service<
  ServerEnvironment,
  {
    readonly getDescriptor: Effect.Effect<ExecutionEnvironmentDescriptor>;
  }
>()("@playstead/server/environment/ServerEnvironment") {}

const platformOs = (
  platform: NodeJS.Platform,
): ExecutionEnvironmentDescriptor["platform"]["os"] => {
  switch (platform) {
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return "unknown";
  }
};

const platformArch = (
  arch: NodeJS.Architecture,
): ExecutionEnvironmentDescriptor["platform"]["arch"] =>
  arch === "arm64" || arch === "x64" ? arch : "other";

const readOrCreateEnvironmentId = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const config = yield* ServerConfig.ServerConfig;
  const idPath = config.environmentIdPath;

  const read = fs.readFileString(idPath).pipe(
    Effect.map((value) => value.trim()),
    Effect.catchIf(
      (cause) => cause.reason._tag === "NotFound",
      () => Effect.succeed(""),
    ),
  );

  const existing = yield* read;
  if (existing.length > 0) return existing;

  // Write to a temporary file and link it into place, so a reader never sees
  // a half-written id and a second server starting at once keeps the first id.
  const generated = yield* crypto.randomUUIDv4();
  yield* Effect.scoped(
    Effect.gen(function* () {
      const tempPath = yield* fs.makeTempFileScoped({
        directory: path.dirname(idPath),
        prefix: ".environment-id-",
      });
      yield* fs.writeFileString(tempPath, `${generated}\n`);
      yield* fs.link(tempPath, idPath).pipe(
        Effect.catchIf(
          (cause) => cause.reason._tag === "AlreadyExists",
          () => Effect.void,
        ),
      );
    }),
  );
  return yield* read;
}).pipe(
  Effect.mapError(
    (cause) =>
      new ServerEnvironmentIdPersistenceError({
        environmentIdPath: "environment-id",
        cause,
      }),
  ),
);

const make = Effect.gen(function* () {
  const environmentId = EnvironmentId.make(yield* readOrCreateEnvironmentId);
  const hostname = NodeOS.hostname().trim();
  const descriptor: ExecutionEnvironmentDescriptor = {
    environmentId,
    label: hostname.length > 0 ? hostname : "This computer",
    platform: { os: platformOs(process.platform), arch: platformArch(process.arch) },
    serverVersion: ServerConfig.serverVersion,
  };
  return ServerEnvironment.of({ getDescriptor: Effect.succeed(descriptor) });
});

export const layer = Layer.effect(ServerEnvironment, make);

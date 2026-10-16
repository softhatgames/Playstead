import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

export class SecretStoreError extends Schema.TaggedError<SecretStoreError>()("SecretStoreError", {
  resource: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to read or create ${this.resource}.`;
  }
}

/**
 * Secrets the server keeps across restarts, one file each in `secrets/`
 * (folder 0700, files 0600).
 */
export class ServerSecretStore extends Context.Service<
  ServerSecretStore,
  {
    readonly getOrCreateRandom: (
      name: string,
      bytes: number,
    ) => Effect.Effect<Uint8Array, SecretStoreError>;
  }
>()("@playstead/server/auth/ServerSecretStore") {}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;

  yield* fs.makeDirectory(config.secretsDir, { recursive: true }).pipe(
    Effect.andThen(fs.chmod(config.secretsDir, 0o700)),
    Effect.mapError((cause) => new SecretStoreError({ resource: "the secrets directory", cause })),
  );

  const getOrCreateRandom = (name: string, bytes: number) => {
    const secretPath = path.join(config.secretsDir, `${name}.bin`);
    const read = fs.readFile(secretPath).pipe(Effect.map((value) => Uint8Array.from(value)));
    const create = Effect.gen(function* () {
      const generated = yield* crypto.randomBytes(bytes);
      yield* Effect.scoped(
        Effect.gen(function* () {
          // `wx` fails if another process created the secret first; that one wins.
          const file = yield* fs.open(secretPath, { flag: "wx", mode: 0o600 });
          yield* file.writeAll(generated);
          yield* file.sync;
        }),
      );
      return generated;
    });
    return read.pipe(
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () =>
          create.pipe(
            Effect.catchIf(
              (cause) => cause._tag === "PlatformError" && cause.reason._tag === "AlreadyExists",
              () => read,
            ),
          ),
      ),
      Effect.mapError((cause) => new SecretStoreError({ resource: `secret ${name}`, cause })),
    );
  };

  return ServerSecretStore.of({ getOrCreateRandom });
});

export const layer = Layer.effect(ServerSecretStore, make);

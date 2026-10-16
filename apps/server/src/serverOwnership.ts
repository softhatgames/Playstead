// @effect-diagnostics nodeBuiltinImport:off -- The ownership lock is a native SQLite handle held for the server's lifetime.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";

import * as ServerConfig from "./config.ts";

/** T3 Code's `SERVER_EXIT_CODE_STATE_DIR_OWNED`: another server owns the state directory. */
const SERVER_EXIT_CODE_STATE_DIR_OWNED = 78;

class ServerAlreadyRunningError extends Schema.TaggedError<ServerAlreadyRunningError>()(
  "ServerAlreadyRunningError",
  { stateDir: Schema.String },
) {
  // A distinct exit code tells "another server owns this home" apart from a crash.
  override readonly [Runtime.errorExitCode] = SERVER_EXIT_CODE_STATE_DIR_OWNED;

  override get message(): string {
    return `A Playstead server already owns ${this.stateDir}. Stop that server, or use another Playstead home, then retry. No server was stopped.`;
  }
}

class ServerOwnershipError extends Schema.TaggedError<ServerOwnershipError>()(
  "ServerOwnershipError",
  { stateDir: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not take ownership of ${this.stateDir}.`;
  }
}

const isSqliteBusy = (cause: unknown) =>
  cause instanceof Error &&
  (("errcode" in cause && cause.errcode === 5) ||
    ("code" in cause && cause.code === "SQLITE_BUSY"));

/**
 * One server per Playstead home (T3 Code's `apps/server/src/serverOwnership.ts`
 * at 2577baf, without the legacy owner check or `server-runtime.json`, which
 * nothing in Playstead reads). Startup recovery cancels every run it finds
 * active, so it must be the only server using the database. The lock is an
 * exclusive transaction on `server-owner.sqlite`, taken before the database
 * opens and held until the server stops. The operating system releases it
 * when the process exits, even when it is killed, so a crashed server never
 * blocks the next start.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig.ServerConfig;
    yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          NodeFS.mkdirSync(stateDir, { recursive: true });
          const db = new NodeSqlite.DatabaseSync(NodePath.join(stateDir, "server-owner.sqlite"));
          try {
            db.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
          } catch (cause) {
            db.close();
            throw cause;
          }
          return db;
        },
        catch: (cause) =>
          isSqliteBusy(cause)
            ? new ServerAlreadyRunningError({ stateDir })
            : new ServerOwnershipError({ stateDir, cause }),
      }),
      (db) => Effect.sync(() => db.close()),
    );
  }),
);

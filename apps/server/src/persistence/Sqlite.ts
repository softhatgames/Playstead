import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { runMigrations } from "./Migrations.ts";

const layerSetup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA foreign_keys = ON;`;
    // In WAL mode NORMAL syncs only at checkpoints. It cannot corrupt the
    // database; an OS crash can roll back commits since the last checkpoint.
    yield* sql`PRAGMA synchronous = NORMAL;`;
    yield* runMigrations();
  }),
);

const layerFromPath = (dbPath: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });
      // The client turns on WAL and a five-second busy timeout itself.
      return Layer.provideMerge(layerSetup, SqliteClient.layer({ filename: dbPath }));
    }),
  );

export const layerConfig = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return layerFromPath(config.dbPath);
  }),
);

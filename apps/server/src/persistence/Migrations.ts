import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";

import Migration0001 from "./Migrations/001_Initial.ts";

/**
 * Every migration, in order. A new one is a new file `NNN_Name.ts` and an entry
 * here; a released migration is never edited.
 */
const migrationEntries = [[1, "Initial", Migration0001]] as const;

const run = Migrator.make({});

export const runMigrations = Effect.fn("runMigrations")(function* () {
  const executed = yield* run({
    loader: Migrator.fromRecord(
      Object.fromEntries(migrationEntries.map(([id, name, effect]) => [`${id}_${name}`, effect])),
    ),
  });
  if (executed.length > 0) {
    yield* Effect.logDebug("Migrations ran").pipe(
      Effect.annotateLogs({ migrations: executed.map(([id, name]) => `${id}_${name}`) }),
    );
  }
});

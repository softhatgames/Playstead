import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Removing a project is a soft delete (T3 Code's `projection_projects.deleted_at`
 * at 2577baf): the row stays with the time it was removed, and reads skip it
 * unless they ask for removed projects too.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN deleted_at TEXT`;
});

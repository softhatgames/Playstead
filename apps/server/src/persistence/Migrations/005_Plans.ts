import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The plans a thread's providers make, its proposed plans and todo lists,
 * as rows like the other thread projections (T3 Code's
 * `orchestration_v2_projection_plans` at 2577baf, with each row's fields as
 * JSON).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE orchestration_v2_projection_plans (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      first_sequence INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX idx_orchestration_v2_projection_plans_thread
    ON orchestration_v2_projection_plans(thread_id, first_sequence)
  `;
});

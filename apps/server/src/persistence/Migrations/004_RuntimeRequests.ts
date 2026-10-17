import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The runtime requests a thread's providers raise, as rows like the other
 * thread projections (T3 Code's `orchestration_v2_projection_runtime_requests`
 * at 2577baf, with each row's fields as JSON).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE orchestration_v2_projection_runtime_requests (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      first_sequence INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX idx_orchestration_v2_projection_runtime_requests_thread
    ON orchestration_v2_projection_runtime_requests(thread_id, first_sequence)
  `;
});

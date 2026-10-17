import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Tables named after the projection rows the orchestration core keeps for each thread.
 * T3 Code at 2577baf keeps each kind in its own table, `orchestration_v2_projection_*`,
 * with a column per field. Playstead keeps the same tables with each row's
 * fields as JSON, plus the thread it belongs to and the sequence of the event
 * that first wrote it, which orders the rows.
 */
const PROJECTION_TABLES = [
  "orchestration_v2_projection_runs",
  "orchestration_v2_projection_run_attempts",
  "orchestration_v2_projection_nodes",
  "orchestration_v2_projection_provider_sessions",
  "orchestration_v2_projection_provider_threads",
  "orchestration_v2_projection_provider_turns",
  "orchestration_v2_projection_messages",
  "orchestration_v2_projection_turn_items",
] as const;

/**
 * The orchestration core's tables: the thread projections and the effect
 * outbox (T3 Code's `orchestration_v2_projection_*` and
 * `orchestration_v2_effect_outbox` at 2577baf). The outbox has no lease
 * columns: nothing recovers effects after a restart yet.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE orchestration_v2_projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      first_sequence INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX idx_orchestration_v2_projection_threads_project
    ON orchestration_v2_projection_threads(project_id)
  `;

  for (const table of PROJECTION_TABLES) {
    yield* sql`
      CREATE TABLE ${sql(table)} (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        first_sequence INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      )
    `;
    yield* sql`
      CREATE INDEX ${sql(`idx_${table}_thread`)}
      ON ${sql(table)}(thread_id, first_sequence)
    `;
  }

  yield* sql`
    CREATE TABLE orchestration_v2_effect_outbox (
      effect_id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      effect_type TEXT NOT NULL,
      request_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX idx_orchestration_v2_effect_outbox_claim
    ON orchestration_v2_effect_outbox(status, thread_id)
  `;
});

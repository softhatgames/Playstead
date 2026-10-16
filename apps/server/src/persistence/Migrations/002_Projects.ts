import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Orchestration's event log and command receipts, and the project projection.
 * The tables are T3 Code's live ones at 2577baf (`orchestration_events`,
 * `orchestration_command_receipts`, `projection_projects`) in the shape
 * Playstead uses: no legacy event version, and projects without scripts,
 * icons, default model or deletion. Project and thread events share the log
 * and its sequence, as in T3 Code.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE orchestration_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      aggregate_kind TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      stream_version INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      command_id TEXT,
      causation_event_id TEXT,
      correlation_id TEXT,
      actor_kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_orchestration_events_stream_version
    ON orchestration_events(aggregate_kind, stream_id, stream_version)
  `;
  yield* sql`
    CREATE INDEX idx_orchestration_events_command_id
    ON orchestration_events(command_id)
  `;

  yield* sql`
    CREATE TABLE orchestration_command_receipts (
      command_id TEXT PRIMARY KEY,
      aggregate_kind TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      result_sequence INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    )
  `;

  yield* sql`
    CREATE TABLE projection_projects (
      project_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX idx_projection_projects_workspace_root
    ON projection_projects(workspace_root)
  `;
});

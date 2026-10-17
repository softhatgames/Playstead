import { IsoDateTime, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import {
  OrchestrationSearchThreadsError,
  type OrchestrationSearchThreadsInput,
  type OrchestrationSearchThreadsResult,
} from "@playstead/contracts/threadSearch";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

export class ThreadSearch extends Context.Service<
  ThreadSearch,
  {
    readonly search: (
      input: OrchestrationSearchThreadsInput,
    ) => Effect.Effect<OrchestrationSearchThreadsResult, OrchestrationSearchThreadsError>;
  }
>()("@playstead/server/orchestration-v2/ThreadSearch") {}

// SQLite LIKE folds ASCII case only; use the same folding to locate the excerpt.
const foldCase = (text: string) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
function snippet(text: string, query: string): string {
  const body = normalize(text);
  if (body.length <= 240) return body;
  const match = foldCase(body).indexOf(foldCase(normalize(query)));
  const start = Math.min(Math.max(0, match - 72), body.length - 236);
  const end = start + 236;
  return `${start ? "…" : ""}${body.slice(start, end)}${end < body.length ? "…" : ""}`;
}

/**
 * Persisted substring search (T3 Code's orchestration-v2/ThreadSearch.ts at
 * 2577baf), expressed against Playstead's JSON projections. Projects currently
 * have no soft-delete field; the join excludes missing projects. Thread archive
 * and deletion are filtered before ranking or limiting the matches.
 */
export const layer = Layer.effect(
  ThreadSearch,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const find = SqlSchema.findAll({
      Request: Schema.Struct({ pattern: Schema.String, limit: Schema.Int }),
      Result: Schema.Struct({
        threadId: ThreadId,
        projectId: ProjectId,
        source: Schema.Literals(["user", "assistant"]),
        text: Schema.String,
        messageCreatedAt: Schema.NullOr(IsoDateTime),
      }),
      execute: ({ pattern, limit }) => sql`
      SELECT threadId, projectId, source, text, messageCreatedAt FROM (
        SELECT t.thread_id AS threadId, t.project_id AS projectId,
          json_extract(m.payload_json, '$.role') AS source,
          json_extract(m.payload_json, '$.text') AS text,
          json_extract(m.payload_json, '$.createdAt') AS messageCreatedAt,
          json_extract(t.payload_json, '$.updatedAt') AS activity,
          ROW_NUMBER() OVER (
            PARTITION BY t.thread_id ORDER BY
              CASE json_extract(m.payload_json, '$.role') WHEN 'user' THEN 0 ELSE 1 END,
              json_extract(m.payload_json, '$.createdAt') DESC, m.id
          ) AS position
        FROM orchestration_v2_projection_messages m
        JOIN orchestration_v2_projection_threads t ON t.thread_id = m.thread_id
        JOIN projection_projects p ON p.project_id = t.project_id
        WHERE json_extract(t.payload_json, '$.archivedAt') IS NULL
          AND json_extract(t.payload_json, '$.deletedAt') IS NULL
          AND json_extract(m.payload_json, '$.streaming') = 0
          AND json_extract(m.payload_json, '$.role') IN ('user', 'assistant')
          AND json_extract(m.payload_json, '$.text') LIKE ${pattern} ESCAPE '!'
      ) WHERE position = 1
      ORDER BY CASE source WHEN 'user' THEN 0 ELSE 1 END, activity DESC, threadId
      LIMIT ${limit}
    `,
    });
    return ThreadSearch.of({
      search: Effect.fn("ThreadSearch.search")(function* (input) {
        const pattern = `%${input.query.replace(/[!%_]/g, (character) => `!${character}`)}%`;
        const rows = yield* find({ pattern, limit: input.limit ?? 50 }).pipe(
          Effect.mapError(
            () =>
              new OrchestrationSearchThreadsError({ message: "Unable to search thread messages." }),
          ),
        );
        return {
          matches: rows.map(({ text, ...match }) => ({
            ...match,
            snippet: snippet(text, input.query),
          })),
        };
      }),
    });
  }),
);

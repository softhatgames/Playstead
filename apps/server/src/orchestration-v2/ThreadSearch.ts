import { IsoDateTime, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import {
  type OrchestrationSearchThreadsInput,
  type OrchestrationSearchThreadsResult,
  OrchestrationThreadSearchSource,
} from "@playstead/contracts/threadSearch";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export class ThreadSearchError extends Schema.TaggedError<ThreadSearchError>()(
  "ThreadSearchError",
  { operation: Schema.Literals(["query", "decode"]), cause: Schema.Defect() },
) {
  override get message(): string {
    return `Thread search ${this.operation} failed.`;
  }
}

const SearchRows = Schema.Array(
  Schema.Struct({
    threadId: ThreadId,
    projectId: ProjectId,
    source: OrchestrationThreadSearchSource,
    matchText: Schema.String,
    messageCreatedAt: Schema.NullOr(IsoDateTime),
  }),
);
const decodeSearchRows = Schema.decodeUnknownEffect(SearchRows);

const DEFAULT_LIMIT = 50;
const SNIPPET_MAX = 240;
// The snippet's text when it is cut, leaving room for an ellipsis at each end.
const SNIPPET_BODY = SNIPPET_MAX - 4;
// How much of what comes before the match a cut snippet keeps.
const SNIPPET_LEAD = 72;

/** `!` escapes SQLite's `LIKE` wildcards, so the query matches as typed. */
const escapeLikePattern = (value: string) =>
  value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_");

// SQLite's `LIKE` folds ASCII letters only; the snippet finds the match the same way.
const foldAsciiCase = (value: string) =>
  value.replace(/[A-Z]/g, (character) => character.toLowerCase());

/**
 * The message on one line, cut around the match when it is longer than a
 * snippet may be, with an ellipsis where text was left out.
 */
const searchSnippet = (text: string, query: string) => {
  const flattened = text.replace(/\s+/g, " ").trim();
  if (flattened.length <= SNIPPET_MAX) return flattened;
  const needle = foldAsciiCase(query.replace(/\s+/g, " ").trim());
  const matchAt = foldAsciiCase(flattened).indexOf(needle);
  const start = Math.min(Math.max(0, matchAt - SNIPPET_LEAD), flattened.length - SNIPPET_BODY);
  const end = Math.min(flattened.length, start + SNIPPET_BODY);
  return `${start > 0 ? "…" : ""}${flattened.slice(start, end)}${end < flattened.length ? "…" : ""}`;
};

/**
 * Searches what was said in the sidebar's threads (T3 Code's
 * `apps/server/src/orchestration-v2/ThreadSearch.ts` at 2577baf): a
 * substring of finished messages from the person or the agent, in threads
 * neither archived nor deleted, in projects not removed. Each thread gives its best message: the
 * person's before the agent's, newest first. Threads where the person said
 * it come first, then the most recently active. Titles are not searched
 * here; the client matches them itself.
 */
export class ThreadSearch extends Context.Service<
  ThreadSearch,
  {
    readonly search: (
      input: OrchestrationSearchThreadsInput,
    ) => Effect.Effect<OrchestrationSearchThreadsResult, ThreadSearchError>;
  }
>()("@playstead/server/orchestration-v2/ThreadSearch") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Thread and message fields live in their JSON payloads. Playstead's
  // SQLite has one connection, so the scan runs there (T3 Code's runs on a
  // reader worker).
  const searchRows = (pattern: string, limit: number) => sql`
    WITH candidate AS (
      SELECT
        threads.thread_id,
        threads.project_id,
        json_extract(messages.payload_json, '$.role') AS role,
        json_extract(messages.payload_json, '$.text') AS match_text,
        json_extract(messages.payload_json, '$.createdAt') AS message_created_at,
        messages.id AS message_id,
        json_extract(threads.payload_json, '$.updatedAt') AS thread_updated_at
      FROM orchestration_v2_projection_messages AS messages
      INNER JOIN orchestration_v2_projection_threads AS threads
        ON threads.thread_id = messages.thread_id
      INNER JOIN projection_projects AS projects
        ON projects.project_id = threads.project_id
      WHERE projects.deleted_at IS NULL
        AND json_extract(threads.payload_json, '$.deletedAt') IS NULL
        AND json_extract(threads.payload_json, '$.archivedAt') IS NULL
        AND json_extract(messages.payload_json, '$.streaming') = 0
        AND json_extract(messages.payload_json, '$.role') IN ('user', 'assistant')
        AND json_extract(messages.payload_json, '$.text') LIKE ${pattern} ESCAPE '!'
    ),
    ranked AS (
      SELECT
        thread_id,
        project_id,
        role AS source,
        match_text,
        message_created_at,
        CASE role WHEN 'user' THEN 0 ELSE 1 END AS match_rank,
        thread_updated_at,
        ROW_NUMBER() OVER (
          PARTITION BY thread_id
          ORDER BY
            CASE role WHEN 'user' THEN 0 ELSE 1 END ASC,
            message_created_at DESC,
            message_id ASC
        ) AS thread_match_rank
      FROM candidate
    )
    SELECT
      thread_id AS "threadId",
      project_id AS "projectId",
      source,
      match_text AS "matchText",
      message_created_at AS "messageCreatedAt"
    FROM ranked
    WHERE thread_match_rank = 1
    ORDER BY match_rank ASC, thread_updated_at DESC, thread_id ASC
    LIMIT ${limit}
  `;

  const search = Effect.fn("ThreadSearch.search")(function* (
    input: OrchestrationSearchThreadsInput,
  ) {
    const raw = yield* searchRows(
      `%${escapeLikePattern(input.query)}%`,
      input.limit ?? DEFAULT_LIMIT,
    ).pipe(Effect.mapError((cause) => new ThreadSearchError({ operation: "query", cause })));
    const rows = yield* decodeSearchRows(raw).pipe(
      Effect.mapError((cause) => new ThreadSearchError({ operation: "decode", cause })),
    );
    return {
      matches: rows.map((row) => ({
        threadId: row.threadId,
        projectId: row.projectId,
        source: row.source,
        snippet: searchSnippet(row.matchText, input.query),
        messageCreatedAt: row.messageCreatedAt,
      })),
    };
  });

  return ThreadSearch.of({ search });
});

export const layer = Layer.effect(ThreadSearch, make);

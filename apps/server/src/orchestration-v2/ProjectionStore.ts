import type { RunId, ThreadId, TurnItemId } from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  OrchestrationV2AppThread,
  OrchestrationV2ConversationMessage,
  OrchestrationV2ExecutionNode,
  OrchestrationV2ProviderSession,
  OrchestrationV2ProviderThread,
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
  OrchestrationV2RunAttempt,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  OrchestrationV2TurnItem,
} from "@playstead/contracts/orchestrationV2";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export class ProjectionStoreV2Error extends Schema.TaggedError<ProjectionStoreV2Error>()(
  "ProjectionStoreV2Error",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Projection store operation '${this.operation}' failed.`;
  }
}

/** Each kind of row a thread's events write, with its table and schema. */
const ENTITIES = {
  runs: { table: "orchestration_v2_projection_runs", schema: OrchestrationV2Run },
  attempts: {
    table: "orchestration_v2_projection_run_attempts",
    schema: OrchestrationV2RunAttempt,
  },
  nodes: { table: "orchestration_v2_projection_nodes", schema: OrchestrationV2ExecutionNode },
  providerSessions: {
    table: "orchestration_v2_projection_provider_sessions",
    schema: OrchestrationV2ProviderSession,
  },
  providerThreads: {
    table: "orchestration_v2_projection_provider_threads",
    schema: OrchestrationV2ProviderThread,
  },
  providerTurns: {
    table: "orchestration_v2_projection_provider_turns",
    schema: OrchestrationV2ProviderTurn,
  },
  messages: {
    table: "orchestration_v2_projection_messages",
    schema: OrchestrationV2ConversationMessage,
  },
  turnItems: { table: "orchestration_v2_projection_turn_items", schema: OrchestrationV2TurnItem },
} as const;
type EntityKind = keyof typeof ENTITIES;

const entityKindOf = (event: OrchestrationV2StoredEvent["event"]): EntityKind | "thread" => {
  switch (event.type) {
    case "thread.created":
    case "thread.metadata-updated":
    case "thread.model-selection-updated":
      return "thread";
    case "run.created":
    case "run.updated":
      return "runs";
    case "run-attempt.created":
    case "run-attempt.updated":
      return "attempts";
    case "node.updated":
      return "nodes";
    case "provider-session.updated":
      return "providerSessions";
    case "provider-thread.updated":
      return "providerThreads";
    case "provider-turn.updated":
      return "providerTurns";
    case "message.updated":
      return "messages";
    case "turn-item.updated":
      return "turnItems";
  }
};

const decodeJsonString = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema));
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeThread = decodeJsonString(OrchestrationV2AppThread);

/** The sidebar's view of a thread: its latest run says whether it is working. */
const toThreadShell = (
  thread: OrchestrationV2AppThread,
  runs: ReadonlyArray<OrchestrationV2Run>,
): OrchestrationV2ThreadShell => {
  const latest = runs.reduce<OrchestrationV2Run | undefined>(
    (found, run) => (found === undefined || run.ordinal > found.ordinal ? run : found),
    undefined,
  );
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    providerInstanceId: thread.providerInstanceId,
    modelSelection: thread.modelSelection,
    latestRunId: latest?.id ?? null,
    activeRunId: latest !== undefined && ACTIVE_RUN_STATUSES.has(latest.status) ? latest.id : null,
    status: latest?.status ?? "idle",
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
};

/**
 * The thread projections (T3 Code's `apps/server/src/orchestration-v2/ProjectionStore.ts`
 * at 2577baf, trimmed to what the thread view and sidebar read). The event
 * sink applies each thread event in its own transaction, so the projection
 * is always as far as the log. Rows keep the order their first event gave
 * them; turn items are written in ordinal order.
 */
export class ProjectionStoreV2 extends Context.Service<
  ProjectionStoreV2,
  {
    /** Call inside the commit transaction. */
    readonly apply: (
      stored: OrchestrationV2StoredEvent,
    ) => Effect.Effect<void, ProjectionStoreV2Error>;
    readonly getThread: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<OrchestrationV2ThreadProjection>, ProjectionStoreV2Error>;
    readonly getThreadShell: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<OrchestrationV2ThreadShell>, ProjectionStoreV2Error>;
    /** Oldest first. */
    readonly listThreadShells: Effect.Effect<
      ReadonlyArray<OrchestrationV2ThreadShell>,
      ProjectionStoreV2Error
    >;
    /**
     * Threads whose projection still says a provider is at work: an active
     * run, a provider session not stopped, or an active provider thread
     * (T3 Code's `getRecoveryThreadIds("runtime")`).
     */
    readonly listRecoveryThreadIds: Effect.Effect<ReadonlyArray<ThreadId>, ProjectionStoreV2Error>;
    /** One run as the projection has it now. */
    readonly getRun: (
      runId: RunId,
    ) => Effect.Effect<Option.Option<OrchestrationV2Run>, ProjectionStoreV2Error>;
    /** The ordinal a stored turn item has, for the sink to keep it. */
    readonly getTurnItemOrdinal: (
      itemId: TurnItemId,
    ) => Effect.Effect<Option.Option<number>, ProjectionStoreV2Error>;
    /** The highest ordinal in the thread, or 0. */
    readonly maxTurnItemOrdinal: (
      threadId: ThreadId,
    ) => Effect.Effect<number, ProjectionStoreV2Error>;
  }
>()("@playstead/server/orchestration-v2/ProjectionStore/ProjectionStoreV2") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const failWith = (operation: string) => (cause: unknown) =>
    new ProjectionStoreV2Error({ operation, cause });

  const apply = (stored: OrchestrationV2StoredEvent) =>
    Effect.gen(function* () {
      const { event } = stored;
      const payloadJson = yield* encodeJson(event.payload);
      const kind = entityKindOf(event);
      if (kind === "thread") {
        const thread = event.payload as OrchestrationV2AppThread;
        yield* sql`
          INSERT INTO orchestration_v2_projection_threads (
            thread_id, project_id, first_sequence, payload_json
          )
          VALUES (${thread.id}, ${thread.projectId}, ${stored.sequence}, ${payloadJson})
          ON CONFLICT (thread_id) DO UPDATE SET payload_json = excluded.payload_json
        `;
        return;
      }
      yield* sql`
        INSERT INTO ${sql(ENTITIES[kind].table)} (id, thread_id, first_sequence, payload_json)
        VALUES (${event.payload.id}, ${event.threadId}, ${stored.sequence}, ${payloadJson})
        ON CONFLICT (id) DO UPDATE SET payload_json = excluded.payload_json
      `;
    }).pipe(Effect.mapError(failWith("apply")));

  const readRows = <S extends Schema.Top & { readonly DecodingServices: never }>(
    entity: { readonly table: string; readonly schema: S },
    threadId: ThreadId,
  ) =>
    sql<{ readonly payloadJson: string }>`
      SELECT payload_json AS "payloadJson"
      FROM ${sql(entity.table)}
      WHERE thread_id = ${threadId}
      ORDER BY first_sequence ASC
    `.pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) => decodeJsonString(entity.schema)(row.payloadJson)),
      ),
    );

  const readThread = (threadId: ThreadId) =>
    sql<{ readonly payloadJson: string }>`
      SELECT payload_json AS "payloadJson"
      FROM orchestration_v2_projection_threads
      WHERE thread_id = ${threadId}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeedNone
          : Effect.asSome(decodeThread(rows[0].payloadJson)),
      ),
    );

  const getThread = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const thread = yield* readThread(threadId);
      if (Option.isNone(thread)) return Option.none();
      const [runs, attempts, nodes, providerSessions, providerThreads, providerTurns, messages] =
        yield* Effect.all([
          readRows(ENTITIES.runs, threadId),
          readRows(ENTITIES.attempts, threadId),
          readRows(ENTITIES.nodes, threadId),
          readRows(ENTITIES.providerSessions, threadId),
          readRows(ENTITIES.providerThreads, threadId),
          readRows(ENTITIES.providerTurns, threadId),
          readRows(ENTITIES.messages, threadId),
        ]);
      const turnItems = [...(yield* readRows(ENTITIES.turnItems, threadId))].sort(
        (left, right) => left.ordinal - right.ordinal,
      );
      return Option.some({
        thread: thread.value,
        runs,
        attempts,
        nodes,
        providerSessions,
        providerThreads,
        providerTurns,
        messages,
        turnItems,
        updatedAt: thread.value.updatedAt,
      } satisfies OrchestrationV2ThreadProjection);
    }).pipe(Effect.mapError(failWith("getThread")));

  const getThreadShell = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const thread = yield* readThread(threadId);
      if (Option.isNone(thread)) return Option.none();
      return Option.some(toThreadShell(thread.value, yield* readRows(ENTITIES.runs, threadId)));
    }).pipe(Effect.mapError(failWith("getThreadShell")));

  const listThreadShells = Effect.gen(function* () {
    const rows = yield* sql<{ readonly payloadJson: string }>`
      SELECT payload_json AS "payloadJson"
      FROM orchestration_v2_projection_threads
      ORDER BY first_sequence ASC
    `;
    return yield* Effect.forEach(rows, (row) =>
      Effect.flatMap(decodeThread(row.payloadJson), (thread) =>
        Effect.map(readRows(ENTITIES.runs, thread.id), (runs) => toThreadShell(thread, runs)),
      ),
    );
  }).pipe(Effect.mapError(failWith("listThreadShells")));

  const listRecoveryThreadIds = sql<{ readonly threadId: ThreadId }>`
    SELECT thread_id AS "threadId" FROM orchestration_v2_projection_runs
    WHERE json_extract(payload_json, '$.status') IN ${sql.in([...ACTIVE_RUN_STATUSES])}
    UNION
    SELECT thread_id AS "threadId" FROM orchestration_v2_projection_provider_sessions
    WHERE json_extract(payload_json, '$.status') NOT IN ('stopped', 'error')
    UNION
    SELECT thread_id AS "threadId" FROM orchestration_v2_projection_provider_threads
    WHERE json_extract(payload_json, '$.status') = 'active'
  `.pipe(
    Effect.map((rows) => rows.map((row) => row.threadId)),
    Effect.mapError(failWith("listRecoveryThreadIds")),
  );

  const getTurnItemOrdinal = (itemId: TurnItemId) =>
    sql<{ readonly ordinal: number }>`
      SELECT json_extract(payload_json, '$.ordinal') AS ordinal
      FROM orchestration_v2_projection_turn_items
      WHERE id = ${itemId}
    `.pipe(
      Effect.map((rows) => Option.fromUndefinedOr(rows[0]?.ordinal)),
      Effect.mapError(failWith("getTurnItemOrdinal")),
    );

  const maxTurnItemOrdinal = (threadId: ThreadId) =>
    sql<{ readonly ordinal: number | null }>`
      SELECT MAX(json_extract(payload_json, '$.ordinal')) AS ordinal
      FROM orchestration_v2_projection_turn_items
      WHERE thread_id = ${threadId}
    `.pipe(
      Effect.map((rows) => rows[0]?.ordinal ?? 0),
      Effect.mapError(failWith("maxTurnItemOrdinal")),
    );

  const getRun = (runId: RunId) =>
    sql<{ readonly payloadJson: string }>`
      SELECT payload_json AS "payloadJson" FROM orchestration_v2_projection_runs
      WHERE id = ${runId}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeedNone
          : Effect.asSome(decodeJsonString(OrchestrationV2Run)(rows[0].payloadJson)),
      ),
      Effect.mapError(failWith("getRun")),
    );

  return ProjectionStoreV2.of({
    apply,
    getRun,
    getThread,
    getThreadShell,
    listThreadShells,
    listRecoveryThreadIds,
    getTurnItemOrdinal,
    maxTurnItemOrdinal,
  });
});

export const layer = Layer.effect(ProjectionStoreV2, make);

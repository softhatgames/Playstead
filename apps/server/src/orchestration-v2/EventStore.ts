import {
  ApplicationProjectEvent,
  type ApplicationStoredEvent,
} from "@playstead/contracts/applicationEvent";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

export class EventStoreAppendEventsError extends Schema.TaggedError<EventStoreAppendEventsError>()(
  "EventStoreAppendEventsError",
  { eventCount: Schema.Number, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Failed to append ${this.eventCount} orchestration event(s).`;
  }
}

export class EventStoreReadEventsError extends Schema.TaggedError<EventStoreReadEventsError>()(
  "EventStoreReadEventsError",
  { afterSequence: Schema.optionalKey(Schema.Number), cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to read orchestration events.";
  }
}

/** A project event before the log gives it its sequence. */
export type UnsequencedProjectEvent = Omit<ApplicationProjectEvent, "sequence">;

/**
 * The orchestration event log: one table, `orchestration_events`, and one
 * sequence for project and thread events (T3 Code's
 * `apps/server/src/orchestration-v2/EventStore.ts` and
 * `apps/server/src/persistence/OrchestrationEventStore.ts` at 2577baf, in one
 * service since Playstead has no legacy events to tell apart). Appends run
 * inside the event sink's transaction; the sink publishes them after commit.
 */
export class EventStoreV2 extends Context.Service<
  EventStoreV2,
  {
    readonly appendProjectEvent: (
      event: UnsequencedProjectEvent,
    ) => Effect.Effect<ApplicationProjectEvent, EventStoreAppendEventsError>;
    readonly latestApplicationSequence: Effect.Effect<number, EventStoreReadEventsError>;
    /** Call only after the transaction that appended `events` has committed. */
    readonly publishCommitted: (
      events: ReadonlyArray<ApplicationStoredEvent>,
    ) => Effect.Effect<void>;
    /**
     * Every event after `afterSequence`: the stored ones, then live ones as
     * they commit, each once and in order.
     */
    readonly streamApplicationEvents: (input: {
      readonly afterSequence: number;
    }) => Stream.Stream<ApplicationStoredEvent, EventStoreReadEventsError>;
  }
>()("@playstead/server/orchestration-v2/EventStore/EventStoreV2") {}

interface EventRow {
  readonly sequence: number;
  readonly eventId: string;
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly commandId: string | null;
  readonly causationEventId: string | null;
  readonly correlationId: string | null;
  readonly type: string;
  readonly payloadJson: string;
}

const decodeProjectEvent = Schema.decodeUnknownEffect(ApplicationProjectEvent);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const rowToEvent = (row: EventRow) =>
  Effect.flatMap(decodeJson(row.payloadJson), (payload) =>
    decodeProjectEvent({
      sequence: row.sequence,
      eventId: row.eventId,
      aggregateKind: row.aggregateKind,
      aggregateId: row.aggregateId,
      occurredAt: row.occurredAt,
      commandId: row.commandId,
      causationEventId: row.causationEventId,
      correlationId: row.correlationId,
      type: row.type,
      payload,
    }),
  );

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const committed = yield* PubSub.unbounded<ApplicationStoredEvent>();

  const appendProjectEvent = (event: UnsequencedProjectEvent) =>
    Effect.gen(function* () {
      const payloadJson = yield* encodeJson(event.payload);
      const rows = yield* sql<EventRow>`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          ${event.eventId},
          'project',
          ${event.aggregateId},
          COALESCE(
            (
              SELECT MAX(stream_version) + 1
              FROM orchestration_events
              WHERE aggregate_kind = 'project' AND stream_id = ${event.aggregateId}
            ),
            0
          ),
          ${event.type},
          ${event.occurredAt},
          ${event.commandId},
          ${event.causationEventId},
          ${event.correlationId},
          ${event.commandId === null ? "server" : "client"},
          ${payloadJson},
          '{}'
        )
        RETURNING
          sequence,
          event_id AS "eventId",
          aggregate_kind AS "aggregateKind",
          stream_id AS "aggregateId",
          occurred_at AS "occurredAt",
          command_id AS "commandId",
          causation_event_id AS "causationEventId",
          correlation_id AS "correlationId",
          event_type AS "type",
          payload_json AS "payloadJson"
      `;
      const row = rows[0];
      if (row === undefined) return yield* Effect.die("The event insert returned no row.");
      return yield* rowToEvent(row);
    }).pipe(Effect.mapError((cause) => new EventStoreAppendEventsError({ eventCount: 1, cause })));

  const latestApplicationSequence = sql<{ readonly sequence: number | null }>`
    SELECT MAX(sequence) AS sequence FROM orchestration_events
  `.pipe(
    Effect.map((rows) => rows[0]?.sequence ?? 0),
    Effect.mapError((cause) => new EventStoreReadEventsError({ cause })),
  );

  const readBetween = (afterSequence: number, throughSequence: number) =>
    sql<EventRow>`
      SELECT
        sequence,
        event_id AS "eventId",
        aggregate_kind AS "aggregateKind",
        stream_id AS "aggregateId",
        occurred_at AS "occurredAt",
        command_id AS "commandId",
        causation_event_id AS "causationEventId",
        correlation_id AS "correlationId",
        event_type AS "type",
        payload_json AS "payloadJson"
      FROM orchestration_events
      WHERE sequence > ${afterSequence} AND sequence <= ${throughSequence}
      ORDER BY sequence ASC
    `.pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, rowToEvent)),
      Effect.mapError((cause) => new EventStoreReadEventsError({ afterSequence, cause })),
    );

  // Subscribe before reading the high-water mark: an event that commits while
  // the stored ones are read is then live, not lost.
  const streamApplicationEvents = (input: { readonly afterSequence: number }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const live = yield* PubSub.subscribe(committed);
        const through = Math.max(input.afterSequence, yield* latestApplicationSequence);
        return Stream.concat(
          Stream.fromIterableEffect(readBetween(input.afterSequence, through)),
          Stream.fromSubscription(live).pipe(Stream.filter((event) => event.sequence > through)),
        );
      }),
    );

  return EventStoreV2.of({
    appendProjectEvent,
    latestApplicationSequence,
    publishCommitted: (events) => PubSub.publishAll(committed, events).pipe(Effect.asVoid),
    streamApplicationEvents,
  });
});

export const layer = Layer.effect(EventStoreV2, make);

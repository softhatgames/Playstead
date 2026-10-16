import {
  CommandId,
  EventId,
  type ProjectId,
  type ThreadId,
} from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2DomainEvent,
  OrchestrationV2StoredEvent,
  OrchestrationV2TurnItem,
} from "@playstead/contracts/orchestrationV2";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";

class EventSinkWriteError extends Schema.TaggedError<EventSinkWriteError>()("EventSinkWriteError", {
  commandId: Schema.NullOr(CommandId),
  eventCount: Schema.Number,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to commit ${this.eventCount} orchestration event(s)${this.commandId === null ? "" : ` for command ${this.commandId}`}.`;
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A thread event before the sink gives it its id. */
export type NewDomainEvent = DistributiveOmit<OrchestrationV2DomainEvent, "id">;

export interface EventSinkV2Shape {
  /**
   * Commits a project command's event, the project projection and the
   * accepted receipt in one transaction. A command id that already has a
   * receipt commits nothing and returns that receipt.
   */
  readonly commitProjectCommand: (input: {
    readonly commandId: CommandId;
    readonly projectId: ProjectId;
    readonly commandType: string;
    readonly acceptedAt: DateTime.Utc;
    readonly event: EventStore.UnsequencedProjectEvent;
  }) => Effect.Effect<
    { readonly receipt: CommandReceiptStore.ProjectCommandReceiptV2; readonly committed: boolean },
    EventSinkWriteError
  >;
  /** Keeps the rejection as the command's receipt, unless it already has one. */
  readonly commitRejectedProjectCommand: (input: {
    readonly commandId: CommandId;
    readonly projectId: ProjectId;
    readonly commandType: string;
    readonly rejectedAt: DateTime.Utc;
    readonly error: string;
  }) => Effect.Effect<CommandReceiptStore.ProjectCommandReceiptV2, EventSinkWriteError>;
  /**
   * Commits a thread command's events, their projections, its outbox effects
   * and the accepted receipt in one transaction, then publishes the events.
   * A command id that already has a receipt commits nothing and returns it.
   */
  readonly commitCommand: (input: {
    readonly commandId: CommandId;
    readonly threadId: ThreadId;
    readonly commandType: string;
    readonly acceptedAt: DateTime.Utc;
    readonly events: ReadonlyArray<NewDomainEvent>;
    readonly effects: ReadonlyArray<EffectOutbox.PendingEffect>;
    /** Cancels the thread's process-bound effects in the same transaction. */
    readonly cancelUnsettledEffects?: { readonly reason: string };
  }) => Effect.Effect<
    { readonly receipt: CommandReceiptStore.CommandReceiptV2; readonly committed: boolean },
    EventSinkWriteError
  >;
  /** Keeps a thread command's rejection as its receipt, unless it already has one. */
  readonly commitRejectedCommand: (input: {
    readonly commandId: CommandId;
    readonly threadId: ThreadId;
    readonly commandType: string;
    readonly rejectedAt: DateTime.Utc;
    readonly error: string;
  }) => Effect.Effect<CommandReceiptStore.CommandReceiptV2, EventSinkWriteError>;
  /**
   * Commits events no command caused, such as a provider's output, with
   * their projections in one transaction, then publishes them.
   */
  readonly write: (
    events: ReadonlyArray<NewDomainEvent>,
  ) => Effect.Effect<ReadonlyArray<OrchestrationV2StoredEvent>, EventSinkWriteError>;
}

/**
 * Where every orchestration write commits (T3 Code's
 * `apps/server/src/orchestration-v2/EventSink.ts` at 2577baf): project and
 * thread commands, and provider output. Events, projections, outbox effects
 * and receipts commit together, and subscribers see events only after. New
 * turn items get the next ordinal in their thread, as T3 Code's
 * `TurnItemPositionStore.normalize` gives them.
 */
export class EventSinkV2 extends Context.Service<EventSinkV2, EventSinkV2Shape>()(
  "@playstead/server/orchestration-v2/EventSink/EventSinkV2",
) {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
  const eventStore = yield* EventStore.EventStoreV2;
  const projectStore = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const outbox = yield* EffectOutbox.EffectOutboxV2;
  const crypto = yield* Crypto.Crypto;

  // SQLite runs one transaction at a time, but each writer publishes after
  // its commit. A writer takes the lane before its transaction commits and
  // keeps it until it has published, so subscribers see events in sequence.
  const publishLane = yield* Semaphore.make(1);
  const commitThenPublish = <A, E, R>(
    transaction: Effect.Effect<A, E, R>,
    publish: (committed: A) => Effect.Effect<void>,
  ) =>
    Effect.suspend(() => {
      let holdsLane = false;
      const takeLane = Effect.uninterruptible(
        Effect.andThen(
          publishLane.take(1),
          Effect.sync(() => {
            holdsLane = true;
          }),
        ),
      );
      return sql
        .withTransaction(Effect.tap(transaction, () => takeLane))
        .pipe(
          Effect.tap(publish),
          Effect.ensuring(Effect.suspend(() => (holdsLane ? publishLane.release(1) : Effect.void))),
        );
    });

  const existingProjectReceipt = (commandId: CommandId) =>
    Effect.flatMap(
      receipts.getProjectByCommandId(commandId),
      Option.match({
        onNone: () => Effect.fail(`Command ${commandId} was already used by a thread command.`),
        onSome: Effect.succeed,
      }),
    );

  const existingThreadReceipt = (commandId: CommandId) =>
    Effect.flatMap(
      receipts.getByCommandId(commandId),
      Option.match({
        onNone: () => Effect.fail(`Command ${commandId} was already used by a project command.`),
        onSome: Effect.succeed,
      }),
    );

  const commitProjectCommand: EventSinkV2Shape["commitProjectCommand"] = (input) =>
    commitThenPublish(
      Effect.gen(function* () {
        const reserved: CommandReceiptStore.ProjectCommandReceiptV2 = {
          commandId: input.commandId,
          projectId: input.projectId,
          commandType: input.commandType,
          acceptedAt: input.acceptedAt,
          resultSequence: 0,
          status: "accepted",
          error: null,
        };
        if (!(yield* receipts.insertIfAbsent(reserved))) {
          return { receipt: yield* existingProjectReceipt(input.commandId), event: undefined };
        }
        const event = yield* eventStore.appendProjectEvent(input.event);
        yield* projectStore.apply(event);
        const receipt = { ...reserved, resultSequence: event.sequence };
        yield* receipts.upsert(receipt);
        return { receipt, event };
      }),
      (result) =>
        result.event === undefined ? Effect.void : eventStore.publishCommitted([result.event]),
    ).pipe(
      Effect.map((result) => ({ receipt: result.receipt, committed: result.event !== undefined })),
      Effect.mapError(
        (cause) => new EventSinkWriteError({ commandId: input.commandId, eventCount: 1, cause }),
      ),
    );

  const commitRejectedProjectCommand: EventSinkV2Shape["commitRejectedProjectCommand"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const receipt: CommandReceiptStore.ProjectCommandReceiptV2 = {
            commandId: input.commandId,
            projectId: input.projectId,
            commandType: input.commandType,
            acceptedAt: input.rejectedAt,
            resultSequence: yield* eventStore.latestApplicationSequence,
            status: "rejected",
            error: input.error,
          };
          return (yield* receipts.insertIfAbsent(receipt))
            ? receipt
            : yield* existingProjectReceipt(input.commandId);
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) => new EventSinkWriteError({ commandId: input.commandId, eventCount: 0, cause }),
        ),
      );

  // A new item takes the next ordinal in its thread; an item written before
  // keeps its own, whatever ordinal its producer gave it.
  const withOrdinal = (item: OrchestrationV2TurnItem) =>
    Effect.gen(function* () {
      const existing = yield* projections.getTurnItemOrdinal(item.id);
      if (Option.isSome(existing)) return { ...item, ordinal: existing.value };
      return { ...item, ordinal: (yield* projections.maxTurnItemOrdinal(item.threadId)) + 1 };
    });

  // Inside a transaction. Each event is appended and applied before the next
  // is looked at, so a later item in the batch sees the earlier ones.
  const appendAndApply = (commandId: CommandId | null, events: ReadonlyArray<NewDomainEvent>) =>
    Effect.forEach(events, (pending) =>
      Effect.gen(function* () {
        const id = EventId.make(`event:${yield* crypto.randomUUIDv4()}`);
        const event: OrchestrationV2DomainEvent =
          pending.type === "turn-item.updated"
            ? { ...pending, id, payload: yield* withOrdinal(pending.payload) }
            : ({ ...pending, id } as OrchestrationV2DomainEvent);
        const stored = yield* eventStore.appendThreadEvent({ commandId, event });
        yield* projections.apply(stored);
        return stored;
      }),
    );

  const publishThreadEvents = (events: ReadonlyArray<OrchestrationV2StoredEvent>) =>
    events.length === 0 ? Effect.void : eventStore.publishCommitted(events);

  const commitCommand: EventSinkV2Shape["commitCommand"] = (input) =>
    commitThenPublish(
      Effect.gen(function* () {
        const reserved: CommandReceiptStore.CommandReceiptV2 = {
          commandId: input.commandId,
          threadId: input.threadId,
          commandType: input.commandType,
          acceptedAt: input.acceptedAt,
          resultSequence: 0,
          status: "accepted",
          error: null,
        };
        if (!(yield* receipts.insertIfAbsent(reserved))) {
          return { receipt: yield* existingThreadReceipt(input.commandId), events: undefined };
        }
        const events = yield* appendAndApply(input.commandId, input.events);
        yield* outbox.enqueue({
          commandId: input.commandId,
          threadId: input.threadId,
          effects: input.effects,
          now: DateTime.formatIso(input.acceptedAt),
        });
        if (input.cancelUnsettledEffects !== undefined) {
          yield* outbox.cancelUnsettled({
            threadId: input.threadId,
            reason: input.cancelUnsettledEffects.reason,
            now: DateTime.formatIso(input.acceptedAt),
          });
        }
        const receipt = {
          ...reserved,
          resultSequence: events.at(-1)?.sequence ?? (yield* eventStore.latestApplicationSequence),
        };
        yield* receipts.upsert(receipt);
        return { receipt, events };
      }),
      (result) =>
        result.events === undefined
          ? Effect.void
          : Effect.andThen(
              publishThreadEvents(result.events),
              input.effects.length === 0 ? Effect.void : outbox.notifyAvailable,
            ),
    ).pipe(
      Effect.map((result) => ({ receipt: result.receipt, committed: result.events !== undefined })),
      Effect.mapError(
        (cause) =>
          new EventSinkWriteError({
            commandId: input.commandId,
            eventCount: input.events.length,
            cause,
          }),
      ),
    );

  const commitRejectedCommand: EventSinkV2Shape["commitRejectedCommand"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const receipt: CommandReceiptStore.CommandReceiptV2 = {
            commandId: input.commandId,
            threadId: input.threadId,
            commandType: input.commandType,
            acceptedAt: input.rejectedAt,
            resultSequence: yield* eventStore.latestApplicationSequence,
            status: "rejected",
            error: input.error,
          };
          return (yield* receipts.insertIfAbsent(receipt))
            ? receipt
            : yield* existingThreadReceipt(input.commandId);
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) => new EventSinkWriteError({ commandId: input.commandId, eventCount: 0, cause }),
        ),
      );

  const write: EventSinkV2Shape["write"] = (events) =>
    commitThenPublish(appendAndApply(null, events), publishThreadEvents).pipe(
      Effect.mapError(
        (cause) => new EventSinkWriteError({ commandId: null, eventCount: events.length, cause }),
      ),
    );

  return EventSinkV2.of({
    commitProjectCommand,
    commitRejectedProjectCommand,
    commitCommand,
    commitRejectedCommand,
    write,
  });
});

export const layer = Layer.effect(EventSinkV2, make);

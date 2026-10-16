import { CommandId, type ProjectId } from "@playstead/contracts/baseSchemas";
import * as Context from "effect/Context";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectStore from "./ProjectStore.ts";

class EventSinkWriteError extends Schema.TaggedError<EventSinkWriteError>()("EventSinkWriteError", {
  commandId: CommandId,
  eventCount: Schema.Number,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to commit ${this.eventCount} orchestration event(s) for command ${this.commandId}.`;
  }
}

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
}

/**
 * Where every orchestration write commits (T3 Code's
 * `apps/server/src/orchestration-v2/EventSink.ts` at 2577baf). So far it
 * commits project commands; the orchestration core adds thread commands,
 * their projections and outbox effects to the same transaction.
 */
export class EventSinkV2 extends Context.Service<EventSinkV2, EventSinkV2Shape>()(
  "@playstead/server/orchestration-v2/EventSink/EventSinkV2",
) {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
  const eventStore = yield* EventStore.EventStoreV2;
  const projectStore = yield* ProjectStore.ProjectStoreV2;

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

  return EventSinkV2.of({ commitProjectCommand, commitRejectedProjectCommand });
});

export const layer = Layer.effect(EventSinkV2, make);

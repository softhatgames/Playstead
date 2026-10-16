import type { ThreadId } from "@playstead/contracts/baseSchemas";
import {
  OrchestrationThreadNotFoundError,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2ThreadStreamItem,
} from "@playstead/contracts/orchestrationV2";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as EventStore from "./EventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/**
 * One thread for the thread view (T3 Code's `subscribeOrchestrationV2Thread`
 * in `apps/server/src/ws.ts` and `ThreadStream.ts` at 2577baf): its whole
 * projection with the sequence it reaches, read in one transaction, then
 * each of its events after that sequence. There is no resuming from a
 * sequence or history paging; a reconnecting client takes a new snapshot.
 */
export const streamThread = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const eventStore = yield* EventStore.EventStoreV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;

    const { snapshotSequence, projection } = yield* sql.withTransaction(
      Effect.all({
        snapshotSequence: eventStore.latestApplicationSequence,
        projection: projections.getThread(threadId),
      }),
    );
    if (Option.isNone(projection)) {
      return yield* new OrchestrationThreadNotFoundError({ threadId });
    }

    const events = eventStore.streamApplicationEvents({ afterSequence: snapshotSequence }).pipe(
      Stream.filter(
        (stored): stored is OrchestrationV2StoredEvent =>
          stored.aggregateKind === "thread" && stored.event.threadId === threadId,
      ),
      Stream.map((stored): OrchestrationV2ThreadStreamItem => ({
        kind: "event",
        sequence: stored.sequence,
        event: stored.event,
      })),
    );

    return Stream.concat(
      Stream.make<[OrchestrationV2ThreadStreamItem]>({
        kind: "snapshot",
        snapshotSequence,
        projection: projection.value,
      }),
      events,
    );
  }).pipe(Stream.unwrap);

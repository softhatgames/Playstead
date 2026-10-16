import type { OrchestrationV2ShellStreamItem } from "@playstead/contracts/orchestrationV2";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectService from "../project/ProjectService.ts";
import * as EventStore from "./EventStore.ts";

/**
 * The sidebar's shell (T3 Code's `subscribeOrchestrationV2Shell` in
 * `apps/server/src/ws.ts` and `apps/server/src/orchestration-v2/ShellStream.ts`
 * at 2577baf): a snapshot read in one transaction with the sequence it
 * reaches, then each project as events after that sequence change it.
 * Threads join with the orchestration core.
 */
export const streamShell = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* EventStore.EventStoreV2;
  const projects = yield* ProjectService.ProjectService;

  const snapshot = yield* sql.withTransaction(
    Effect.all({
      snapshotSequence: eventStore.latestApplicationSequence,
      projects: projects.listShells,
    }),
  );

  const changes = eventStore
    .streamApplicationEvents({ afterSequence: snapshot.snapshotSequence })
    .pipe(
      Stream.mapEffect((event) =>
        Effect.map(
          projects.getShell(event.aggregateId),
          Option.map((project): OrchestrationV2ShellStreamItem => ({
            kind: "project.updated",
            sequence: event.sequence,
            project,
          })),
        ),
      ),
      Stream.filter(Option.isSome),
      Stream.map((item) => item.value),
    );

  return Stream.concat(
    Stream.make<[OrchestrationV2ShellStreamItem]>({ kind: "snapshot", snapshot }),
    changes,
  );
}).pipe(Stream.unwrap);

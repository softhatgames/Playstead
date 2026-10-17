import type { ApplicationStoredEvent } from "@playstead/contracts/applicationEvent";
import type { OrchestrationV2ShellStreamItem } from "@playstead/contracts/orchestrationV2";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectService from "../project/ProjectService.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/** Thread events that change what the sidebar shows: the thread itself, or its runs. */
const SHELL_THREAD_EVENT_TYPES: ReadonlySet<string> = new Set([
  "thread.created",
  "thread.metadata-updated",
  "thread.model-selection-updated",
  "thread.runtime-mode-updated",
  "run.created",
  "run.updated",
]);

/**
 * The sidebar's shell (T3 Code's `subscribeOrchestrationV2Shell` in
 * `apps/server/src/ws.ts` and `apps/server/src/orchestration-v2/ShellStream.ts`
 * at 2577baf): a snapshot of projects and threads read in one transaction
 * with the sequence it reaches, then each project or thread as events after
 * that sequence change it.
 */
export const streamShell = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* EventStore.EventStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  const snapshot = yield* sql.withTransaction(
    Effect.all({
      snapshotSequence: eventStore.latestApplicationSequence,
      projects: projects.listShells,
      threads: projections.listThreadShells,
    }),
  );

  const toItem = (
    event: ApplicationStoredEvent,
  ): Effect.Effect<Option.Option<OrchestrationV2ShellStreamItem>, unknown> => {
    if (event.aggregateKind === "project") {
      return Effect.map(
        projects.getShell(event.aggregateId),
        Option.map((project) => ({ kind: "project.updated", sequence: event.sequence, project })),
      );
    }
    if (!SHELL_THREAD_EVENT_TYPES.has(event.event.type)) return Effect.succeedNone;
    return Effect.map(
      projections.getThreadShell(event.event.threadId),
      Option.map((thread) => ({ kind: "thread.updated", sequence: event.sequence, thread })),
    );
  };

  const changes = eventStore
    .streamApplicationEvents({ afterSequence: snapshot.snapshotSequence })
    .pipe(
      Stream.mapEffect(toItem),
      Stream.filter(Option.isSome),
      Stream.map((item) => item.value),
    );

  return Stream.concat(
    Stream.make<[OrchestrationV2ShellStreamItem]>({ kind: "snapshot", snapshot }),
    changes,
  );
}).pipe(Stream.unwrap);

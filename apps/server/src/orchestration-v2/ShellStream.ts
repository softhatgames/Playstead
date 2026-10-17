import type { ThreadId } from "@playstead/contracts/baseSchemas";
import type { ApplicationStoredEvent } from "@playstead/contracts/applicationEvent";
import type {
  OrchestrationV2ArchivedShellStreamItem,
  OrchestrationV2ShellStreamItem,
  OrchestrationV2StoredEvent,
  OrchestrationV2ThreadShell,
} from "@playstead/contracts/orchestrationV2";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectService from "../project/ProjectService.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/** Thread events that change what the sidebar or the archive shows: the thread itself, or its runs. */
const SHELL_THREAD_EVENT_TYPES: ReadonlySet<string> = new Set([
  "thread.created",
  "thread.metadata-updated",
  "thread.model-selection-updated",
  "thread.archived",
  "thread.unarchived",
  "thread.deleted",
  "thread.visited",
  "thread.marked-unread",
  "thread.pinned",
  "thread.unpinned",
  "thread.auto-settle-set",
  "thread.settled",
  "thread.unsettled",
  "run.created",
  "run.updated",
]);

/**
 * What the sidebar is told after a thread event (T3 Code's
 * `shellStreamItemFromThreadShell` in `ShellStream.ts` at 2577baf): the
 * thread as it is now, or its removal once it is archived, deleted or gone.
 */
const activeShellItem = (
  sequence: number,
  threadId: ThreadId,
  shell: Option.Option<OrchestrationV2ThreadShell>,
): OrchestrationV2ShellStreamItem =>
  Option.isSome(shell) && shell.value.archivedAt === null && shell.value.deletedAt === null
    ? { kind: "thread.updated", sequence, thread: shell.value }
    : { kind: "thread.removed", sequence, threadId };

/**
 * What **Settings → Archive** is told after a thread event (T3 Code's
 * `archivedShellStreamItemFromThreadShell`): an archived thread as it is now,
 * the removal of one unarchived or deleted while archived, and nothing for
 * any other thread.
 */
const archivedShellItem = (
  stored: OrchestrationV2StoredEvent,
  shell: Option.Option<OrchestrationV2ThreadShell>,
): Option.Option<OrchestrationV2ArchivedShellStreamItem> => {
  if (Option.isSome(shell) && shell.value.archivedAt !== null && shell.value.deletedAt === null) {
    return Option.some({ kind: "thread.updated", sequence: stored.sequence, thread: shell.value });
  }
  const { event } = stored;
  if (
    event.type === "thread.unarchived" ||
    (event.type === "thread.deleted" && event.payload.archivedAt !== null)
  ) {
    return Option.some({
      kind: "thread.removed",
      sequence: stored.sequence,
      threadId: event.threadId,
    });
  }
  return Option.none();
};

const readSnapshot = (location: ProjectionStore.ThreadShellLocation) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const eventStore = yield* EventStore.EventStoreV2;
    const projects = yield* ProjectService.ProjectService;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    return yield* sql.withTransaction(
      Effect.all({
        snapshotSequence: eventStore.latestApplicationSequence,
        projects: projects.listShells,
        threads: projections.listThreadShells(location),
      }),
    );
  });

/**
 * The sidebar's shell (T3 Code's `subscribeOrchestrationV2Shell` in
 * `apps/server/src/ws.ts` and `apps/server/src/orchestration-v2/ShellStream.ts`
 * at 2577baf): a snapshot of projects and the threads not archived, read in
 * one transaction with the sequence it reaches, then each project or thread
 * as events after that sequence change it. A thread archived or deleted is
 * removed.
 */
export const streamShell = Effect.gen(function* () {
  const eventStore = yield* EventStore.EventStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const snapshot = yield* readSnapshot("active");

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
    return Effect.map(projections.getThreadShell(event.event.threadId), (shell) =>
      Option.some(activeShellItem(event.sequence, event.event.threadId, shell)),
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
    Stream.make<[OrchestrationV2ShellStreamItem]>({
      kind: "snapshot",
      snapshot: { ...snapshot, archivedThreads: [] },
    }),
    changes,
  );
}).pipe(Stream.unwrap);

/** **Settings → Archive**'s threads now (T3 Code's `getOrchestrationV2ArchivedShellSnapshot`). */
export const getArchivedShellSnapshot = readSnapshot("archive");

/**
 * **Settings → Archive**'s threads (T3 Code's `subscribeOrchestrationV2ArchivedShell`):
 * the archived snapshot, then each archived thread as it changes, and the
 * removal of each one unarchived or deleted.
 */
export const streamArchivedShell = Effect.gen(function* () {
  const eventStore = yield* EventStore.EventStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const snapshot = yield* getArchivedShellSnapshot;

  const toItem = (
    event: ApplicationStoredEvent,
  ): Effect.Effect<
    Option.Option<OrchestrationV2ArchivedShellStreamItem>,
    unknown,
    Effect.Services<typeof getArchivedShellSnapshot>
  > => {
    // The archive groups by the projects in its snapshot. Refresh those too
    // when another client adds a project while this page stays open.
    if (event.aggregateKind === "project") {
      return Effect.map(getArchivedShellSnapshot, (snapshot) =>
        Option.some({ kind: "snapshot" as const, snapshot }),
      );
    }
    if (!SHELL_THREAD_EVENT_TYPES.has(event.event.type)) return Effect.succeedNone;
    return Effect.map(projections.getThreadShell(event.event.threadId), (shell) =>
      archivedShellItem(event, shell),
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
    Stream.make<[OrchestrationV2ArchivedShellStreamItem]>({ kind: "snapshot", snapshot }),
    changes,
  );
}).pipe(Stream.unwrap);

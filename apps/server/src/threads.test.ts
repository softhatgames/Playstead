import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { assert, describe, it } from "@effect/vitest";
import { applyArchivedShellStreamItem } from "@playstead/client-runtime/state/archivedThreads";
import type { LocalConnection } from "@playstead/client-runtime/connection";
import { CommandId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2ArchivedShellSnapshot,
  OrchestrationV2Command,
  OrchestrationV2ThreadShell,
} from "@playstead/contracts/orchestrationV2";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { awaitConnectionState, connectSignedIn } from "./testUtils/testClient.ts";
import { startTestServer } from "./testUtils/testServer.ts";

/**
 * Archive and delete over the RPC contract, as the interface does them: the
 * sidebar's shell and **Settings → Archive**'s archived shell follow each
 * command (T3 Code's `ShellStream.test.ts` cases at 2577baf).
 */

/** **Settings → Archive**'s threads, folded from the archived shell stream as the page does. */
const followArchive = (connection: LocalConnection) =>
  Effect.gen(function* () {
    const archive = yield* SubscriptionRef.make<OrchestrationV2ArchivedShellSnapshot | undefined>(
      undefined,
    );
    yield* Effect.forkScoped(
      connection
        .stream((client) => client["orchestration.subscribeArchivedShell"]({}))
        .pipe(
          Stream.runForEach((item) =>
            SubscriptionRef.update(archive, (current) =>
              applyArchivedShellStreamItem(current, item),
            ),
          ),
        ),
    );
    return (matches: (ids: ReadonlyArray<string>) => boolean) =>
      SubscriptionRef.changes(archive).pipe(
        Stream.filter(
          (current) => current !== undefined && matches(current.threads.map((t) => t.id)),
        ),
        Stream.runHead,
        Effect.map((current) => Option.getOrThrow(current)!),
      );
  });

const sameIds = (expected: ReadonlyArray<string>) => (ids: ReadonlyArray<string>) =>
  ids.length === expected.length && ids.every((id, index) => id === expected[index]);

describe("archive and delete over RPC", () => {
  it.layer(
    Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, NodeSocket.layerWebSocketConstructor),
    { excludeTestServices: true },
  )((it) => {
    it.effect(
      "an archived thread leaves the sidebar for the archive, comes back when unarchived, and a deleted one is in neither",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const server = yield* startTestServer();
          const folder = path.join(server.config.baseDir, "space-game");
          yield* fs.makeDirectory(folder);
          const { connection } = yield* connectSignedIn(server);
          const projectId = ProjectId.make("project:space-game");
          const kept = ThreadId.make("thread:kept");
          const shelved = ThreadId.make("thread:shelved");
          const dispatch = (command: OrchestrationV2Command) =>
            connection.request((client) => client["orchestration.dispatchCommand"](command));

          yield* connection.request((client) =>
            client["projects.mutate"]({
              type: "project.create",
              commandId: CommandId.make("command:space-game"),
              projectId,
              title: "space-game",
              workspaceRoot: folder,
            }),
          );
          for (const threadId of [kept, shelved]) {
            yield* dispatch({
              type: "thread.create",
              commandId: CommandId.make(`command:create:${threadId}`),
              threadId,
              projectId,
              title: "New thread",
              modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
            });
          }
          const sidebarHas = (expected: ReadonlyArray<string>) =>
            awaitConnectionState(connection, (state) =>
              sameIds(expected)(state.shell?.threads.map((thread) => thread.id) ?? []),
            );
          yield* sidebarHas([kept, shelved]);
          const archiveHas = yield* followArchive(connection);
          yield* archiveHas(sameIds([]));

          yield* dispatch({
            type: "thread.archive",
            commandId: CommandId.make("command:archive"),
            threadId: shelved,
          });
          yield* sidebarHas([kept]);
          const archived = yield* archiveHas(sameIds([shelved]));
          assert.isNotNull(archived.threads[0]?.archivedAt);
          const snapshot = yield* connection.request((client) =>
            client["orchestration.getArchivedShellSnapshot"]({}),
          );
          assert.deepStrictEqual(
            snapshot.threads.map((thread) => thread.id),
            [shelved],
          );
          assert.deepStrictEqual(
            snapshot.projects.map((project) => project.id),
            [projectId],
          );

          yield* dispatch({
            type: "thread.unarchive",
            commandId: CommandId.make("command:unarchive"),
            threadId: shelved,
          });
          yield* sidebarHas([kept, shelved]);
          yield* archiveHas(sameIds([]));

          // Deleted from the archive, as Settings → Archive does it.
          yield* dispatch({
            type: "thread.archive",
            commandId: CommandId.make("command:archive-again"),
            threadId: shelved,
          });
          yield* archiveHas(sameIds([shelved]));
          yield* dispatch({
            type: "thread.delete",
            commandId: CommandId.make("command:delete-shelved"),
            threadId: shelved,
          });
          yield* archiveHas(sameIds([]));
          // Deleted from the sidebar.
          yield* dispatch({
            type: "thread.delete",
            commandId: CommandId.make("command:delete-kept"),
            threadId: kept,
          });
          yield* sidebarHas([]);

          const after = yield* connection.request((client) =>
            client["orchestration.getArchivedShellSnapshot"]({}),
          );
          assert.deepStrictEqual(after.threads, []);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "the sidebar shows a renamed thread's new title, its read marker after a visit, its pin and its settling",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const server = yield* startTestServer();
          const folder = path.join(server.config.baseDir, "space-game");
          yield* fs.makeDirectory(folder);
          const { connection } = yield* connectSignedIn(server);
          const projectId = ProjectId.make("project:space-game");
          const threadId = ThreadId.make("thread:renamed");
          const dispatch = (command: OrchestrationV2Command) =>
            connection.request((client) => client["orchestration.dispatchCommand"](command));
          yield* connection.request((client) =>
            client["projects.mutate"]({
              type: "project.create",
              commandId: CommandId.make("command:space-game"),
              projectId,
              title: "space-game",
              workspaceRoot: folder,
            }),
          );
          yield* dispatch({
            type: "thread.create",
            commandId: CommandId.make("command:create"),
            threadId,
            projectId,
            title: "New thread",
            modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
          });
          const sidebarThread = (matches: (thread: OrchestrationV2ThreadShell) => boolean) =>
            awaitConnectionState(connection, (state) =>
              (state.shell?.threads ?? []).some(
                (thread) => thread.id === threadId && matches(thread),
              ),
            );
          yield* sidebarThread((thread) => thread.lastVisitedAt === null);

          yield* dispatch({
            type: "thread.metadata.update",
            commandId: CommandId.make("command:rename"),
            threadId,
            title: "Asteroid field",
          });
          yield* sidebarThread((thread) => thread.title === "Asteroid field");
          yield* dispatch({
            type: "thread.visit",
            commandId: CommandId.make("command:visit"),
            threadId,
            visitedAt: "2026-10-17T12:00:00.000Z",
          });
          yield* sidebarThread((thread) => thread.lastVisitedAt === "2026-10-17T12:00:00.000Z");

          // Pin and settle reach the sidebar too: a pin, then a settle that drops it.
          yield* dispatch({
            type: "thread.pin",
            commandId: CommandId.make("command:pin"),
            threadId,
          });
          yield* sidebarThread((thread) => thread.pinnedAt !== null);
          yield* dispatch({
            type: "thread.settle",
            commandId: CommandId.make("command:settle"),
            threadId,
          });
          yield* sidebarThread(
            (thread) =>
              thread.settledOverride === "settled" &&
              thread.settledAt !== null &&
              thread.pinnedAt === null,
          );
        }).pipe(Effect.scoped),
    );
  });
});

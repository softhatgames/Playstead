import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeSqlite from "node:sqlite";
import { makeTestServerConfig } from "../testUtils/testServer.ts";
import * as Stream from "effect/Stream";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { makeOrchestrationHarness } from "../orchestration-v2/testkit/OrchestratorHarness.ts";

/** Seam 1: real orchestration and persistence; the unused provider transport cannot start. */
describe("Project deletion", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("project deletion retains a scratch thread's folder and generated files", () =>
      Effect.gen(function* () {
        const harness = yield* makeOrchestrationHarness({
          claudeRunner: {
            allocateSessionId: Effect.die("No turn expected"),
            open: () => Effect.die("No turn expected"),
          },
        });
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projectId = ProjectId.make("scratch:delete");
        const threadId = ThreadId.make("thread:scratch-delete");
        const workspaceRoot = path.join(harness.home, "scratch");
        yield* harness.projects.create({
          commandId: CommandId.make("scratch-project"),
          projectId,
          title: "Renamed scratch",
          workspaceRoot,
          createWorkspaceRootIfMissing: true,
        });
        yield* harness.orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make("scratch-thread"),
          threadId,
          projectId,
          title: "New thread",
          modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
        });
        yield* harness.orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("scratch-message"),
          threadId,
          messageId: MessageId.make("scratch-message"),
          text: "Make a game",
          titleSeed: "Make a game",
        });
        const folder = Option.getOrThrow(yield* harness.orchestrator.getThreadProjection(threadId))
          .thread.worktreePath!;
        assert.strictEqual(path.dirname(folder), workspaceRoot);
        const file = path.join(folder, "game.txt");
        yield* fs.writeFileString(file, "keep this generated game");
        yield* harness.projects.delete({
          commandId: CommandId.make("remove-scratch"),
          projectId,
          force: true,
        });
        assert.strictEqual(yield* fs.readFileString(file), "keep this generated game");
        const readded = yield* harness.projects.create({
          commandId: CommandId.make("scratch-again"),
          projectId: ProjectId.make("scratch:new"),
          title: "No project",
          workspaceRoot,
        });
        assert.notStrictEqual(readded.id, projectId);
        assert.strictEqual(yield* fs.readFileString(file), "keep this generated game");
      }).pipe(Effect.scoped),
    );

    it.effect(
      "retries a partial cascade after a database failure without repeating committed deletions",
      () =>
        Effect.gen(function* () {
          const config = yield* makeTestServerConfig();
          const harness = yield* makeOrchestrationHarness({
            config,
            claudeRunner: {
              allocateSessionId: Effect.die("No turn expected"),
              open: () => Effect.die("No turn expected"),
            },
          });
          const projectId = ProjectId.make("project:retry");
          yield* harness.projects.create({
            commandId: CommandId.make("create"),
            projectId,
            title: "Game",
            workspaceRoot: harness.home,
          });
          const first = ThreadId.make("thread:first");
          const second = ThreadId.make("thread:second");
          for (const threadId of [first, second]) {
            yield* harness.orchestrator.dispatch({
              type: "thread.create",
              commandId: CommandId.make(`create:${threadId}`),
              threadId,
              projectId,
              title: "New thread",
              modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
            });
          }
          const reusedId = yield* Effect.flip(
            harness.projects.delete({
              commandId: CommandId.make("create"),
              projectId,
              force: true,
            }),
          );
          assert.strictEqual(reusedId._tag, "ProjectOperationError");
          assert.isNull(
            Option.getOrThrow(yield* harness.orchestrator.getThreadProjection(first)).thread
              .deletedAt,
          );
          // Fault injection at the SQLite boundary, without replacing server collaborators.
          const db = yield* Effect.acquireRelease(
            Effect.sync(() => new NodeSqlite.DatabaseSync(config.dbPath)),
            (db) => Effect.sync(() => db.close()),
          );
          yield* Effect.sync(() =>
            db.exec(`CREATE TRIGGER fail_second_delete BEFORE INSERT ON orchestration_events
          WHEN NEW.event_type = 'thread.deleted' AND NEW.stream_id = 'thread:second'
          BEGIN SELECT RAISE(FAIL, 'injected disk write failure'); END`),
          );
          const deletion = { commandId: CommandId.make("remove"), projectId, force: true };
          const failure = yield* Effect.flip(harness.projects.delete(deletion));
          assert.strictEqual(failure._tag, "ProjectOperationError");
          assert.isNotNull(
            Option.getOrThrow(yield* harness.orchestrator.getThreadProjection(first)).thread
              .deletedAt,
          );
          assert.isNull(
            Option.getOrThrow(yield* harness.orchestrator.getThreadProjection(second)).thread
              .deletedAt,
          );
          assert.lengthOf(yield* harness.projects.listShells, 1);
          yield* Effect.sync(() => db.exec("DROP TRIGGER fail_second_delete"));
          yield* harness.projects.delete(deletion);
          yield* harness.projects.delete(deletion);
          const events = yield* harness.eventStore
            .streamApplicationEvents({ afterSequence: 0 })
            .pipe(Stream.take(6), Stream.runCollect);
          assert.deepStrictEqual(
            events.map((event) =>
              event.aggregateKind === "project" ? event.type : event.event.type,
            ),
            [
              "project.created",
              "thread.created",
              "thread.created",
              "thread.deleted",
              "thread.deleted",
              "project.deleted",
            ],
          );
          assert.deepStrictEqual(yield* harness.projects.listShells, []);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "requires force and deletes active and archived threads before removing their project",
      () =>
        Effect.gen(function* () {
          const harness = yield* makeOrchestrationHarness({
            claudeRunner: {
              allocateSessionId: Effect.die("No turn expected"),
              open: () => Effect.die("No turn expected"),
            },
          });
          const projectId = ProjectId.make("project:remove");
          yield* harness.projects.create({
            commandId: CommandId.make("create-project"),
            projectId,
            title: "Game",
            workspaceRoot: harness.home,
          });
          const active = ThreadId.make("thread:active");
          const archived = ThreadId.make("thread:archived");
          for (const threadId of [active, archived]) {
            yield* harness.orchestrator.dispatch({
              type: "thread.create",
              commandId: CommandId.make(`create:${threadId}`),
              threadId,
              projectId,
              title: "New thread",
              modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
            });
          }
          yield* harness.orchestrator.dispatch({
            type: "thread.archive",
            commandId: CommandId.make("archive"),
            threadId: archived,
          });
          yield* harness.orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("queued-message"),
            threadId: active,
            messageId: MessageId.make("message:queued"),
            text: "Build a game",
            titleSeed: "Build a game",
          });
          const deletion = { commandId: CommandId.make("remove"), projectId };
          const refused = yield* Effect.flip(harness.projects.delete(deletion));
          assert.strictEqual(refused._tag, "ProjectNotEmptyError");
          assert.lengthOf(yield* harness.projects.listShells, 1);
          yield* harness.projects.delete({ ...deletion, force: true });
          yield* harness.projects.delete({ ...deletion, force: true });
          for (const threadId of [active, archived]) {
            const projection = Option.getOrThrow(
              yield* harness.orchestrator.getThreadProjection(threadId),
            );
            assert.isNotNull(projection.thread.deletedAt);
          }
          const stopped = Option.getOrThrow(
            yield* harness.orchestrator.getThreadProjection(active),
          );
          assert.deepStrictEqual(
            stopped.runs.map((run) => run.status),
            ["cancelled"],
          );
          yield* harness.worker.drain;
          const refusedCreate = yield* Effect.flip(
            harness.orchestrator.dispatch({
              type: "thread.create",
              commandId: CommandId.make("create-after-delete"),
              threadId: ThreadId.make("thread:too-late"),
              projectId,
              title: "New thread",
              modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
            }),
          );
          assert.strictEqual(refusedCreate._tag, "OrchestrationDispatchCommandError");
          const refusedUpdate = yield* Effect.flip(
            harness.projects.update({
              commandId: CommandId.make("rename-after-delete"),
              projectId,
              title: "Too late",
            }),
          );
          assert.strictEqual(refusedUpdate._tag, "ProjectOperationError");
          assert.deepStrictEqual(yield* harness.projects.listShells, []);
        }).pipe(Effect.scoped),
    );
  });
});

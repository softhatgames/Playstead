import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2Command } from "@playstead/contracts/orchestrationV2";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
} from "@playstead/provider-testing/replayTranscript";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { makeClaudeReplay } from "../orchestration-v2/Adapters/ClaudeAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "../orchestration-v2/testkit/OrchestratorHarness.ts";
import {
  FILE_CREATE_IDS,
  sendFileCreateMessage,
} from "../orchestration-v2/testkit/fixtures/fileCreate.ts";
import { makeTestServerConfig } from "../testUtils/testServer.ts";

/**
 * Seam 1 for removing and renaming a project (T3 Code's
 * `apps/server/src/project/ProjectService.test.ts` and
 * `ProjectService.deletion.test.ts` at 2577baf): the real project service,
 * orchestrator, effect worker and projections in a temporary Playstead home.
 */

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

/** A folder in the harness's home, with a file the person made in it. */
const makeGameFolder = (harness: Harness, name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(harness.home, name);
    yield* fs.makeDirectory(folder);
    yield* fs.writeFileString(path.join(folder, "game.js"), "console.log('jump');\n");
    return folder;
  });

const addProject = (harness: Harness, name: string, folder: string) =>
  harness.projects.create({
    commandId: CommandId.make(`command:create:${name}`),
    projectId: ProjectId.make(`project:${name}`),
    title: name,
    workspaceRoot: folder,
  });

const listedIds = (harness: Harness) =>
  Effect.map(harness.projects.listShells, (shells) => shells.map((shell) => shell.id));

const readRecording = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(
      path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
      "..",
      "orchestration-v2",
      "testkit",
      "fixtures",
      name,
    );
    return yield* decodeProviderReplayNdjson(yield* fs.readFileString(file));
  });

/** Claude's whole final reply in the file-create recording, held back so its turn is still working. */
const FINAL_REPLY =
  'Created `hello-claude.txt` in the current folder with the line "Hello from Claude in Playstead!" using the Write tool.';

const isFinalReply = (frame: unknown) =>
  JSON.stringify(frame).includes(`"type":"text","text":${JSON.stringify(FINAL_REPLY)}`);

const dispatch = (harness: Harness, command: OrchestrationV2Command) =>
  harness.orchestrator.dispatch(command);

const createThread = (harness: Harness, projectId: ProjectId, threadId: ThreadId) =>
  dispatch(harness, {
    type: "thread.create",
    commandId: CommandId.make(`command:create:${threadId}`),
    threadId,
    projectId,
    title: "New thread",
    modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
  });

const projectionOf = (harness: Harness, threadId: ThreadId) =>
  Effect.map(harness.orchestrator.getThreadProjection(threadId), Option.getOrThrow);

/** Every removal in the log so far, as `[stream, event type, command id]`. */
const removals = (harness: Harness) =>
  Effect.gen(function* () {
    const latest = yield* harness.eventStore.latestApplicationSequence;
    const events = yield* harness.eventStore.streamApplicationEvents({ afterSequence: 0 }).pipe(
      Stream.takeUntil((stored) => stored.sequence >= latest),
      Stream.runCollect,
    );
    return events.flatMap((stored): Array<[string, string, string | null]> => {
      if (stored.aggregateKind === "project") {
        return stored.type === "project.deleted"
          ? [[stored.aggregateId, stored.type, stored.commandId]]
          : [];
      }
      return stored.event.type === "thread.deleted"
        ? [[stored.event.threadId, stored.event.type, stored.commandId]]
        : [];
    });
  });

describe("Remove a project", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "removing an empty project leaves its files, and adding the folder again makes a new project",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const harness = yield* makeOrchestrationHarness({});
          const folder = yield* makeGameFolder(harness, "space-game");
          yield* addProject(harness, "space-game", folder);

          yield* harness.projects.delete({
            commandId: CommandId.make("command:remove"),
            projectId: ProjectId.make("project:space-game"),
          });

          assert.deepStrictEqual(yield* listedIds(harness), []);
          assert.strictEqual(
            yield* fs.readFileString(path.join(folder, "game.js")),
            "console.log('jump');\n",
          );

          const again = yield* addProject(harness, "space-game-again", folder);
          assert.strictEqual(again.workspaceRoot, folder);
          assert.deepStrictEqual(yield* listedIds(harness), ["project:space-game-again"]);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "a project with threads is kept unless forced, and forced it deletes them all first, stopping the one Claude is working in",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const config = yield* makeTestServerConfig();
          const recorded = yield* readRecording("file_create.claude.ndjson");
          const replay = yield* makeClaudeReplay(
            yield* materializeReplayWorkspace(recorded, path.join(config.baseDir, "empty-game")),
            { holdBefore: isFinalReply },
          );
          const harness = yield* makeOrchestrationHarness({ claudeRunner: replay.runner, config });
          const { projectId, threadId: working } = FILE_CREATE_IDS;
          yield* sendFileCreateMessage(harness);
          yield* fs.writeFileString(
            path.join(harness.home, "empty-game", "notes.md"),
            "Jump higher on the moon.\n",
          );
          yield* harness.worker.drain;
          yield* replay.awaitHeld;
          const shelved = ThreadId.make("thread:shelved");
          yield* createThread(harness, projectId, shelved);
          yield* dispatch(harness, {
            type: "thread.archive",
            commandId: CommandId.make("command:archive"),
            threadId: shelved,
          });

          const refused = yield* Effect.flip(
            harness.projects.delete({ commandId: CommandId.make("command:remove"), projectId }),
          );
          assert.strictEqual(refused.message, `Project ${projectId} is not empty.`);
          assert.deepStrictEqual(yield* listedIds(harness), [projectId]);
          assert.isNull((yield* projectionOf(harness, working)).thread.deletedAt);

          yield* harness.projects.delete({
            commandId: CommandId.make("command:remove-anyway"),
            projectId,
            force: true,
          });

          assert.deepStrictEqual(yield* listedIds(harness), []);
          const stopped = yield* projectionOf(harness, working);
          assert.isNotNull(stopped.thread.deletedAt);
          assert.deepStrictEqual(
            stopped.runs.map((run) => run.status),
            ["cancelled"],
          );
          assert.deepStrictEqual(
            stopped.providerSessions.map((session) => session.status),
            ["stopped"],
          );
          assert.isNotNull((yield* projectionOf(harness, shelved)).thread.deletedAt);
          assert.strictEqual(
            yield* fs.readFileString(path.join(harness.home, "empty-game", "notes.md")),
            "Jump higher on the moon.\n",
          );

          yield* harness.worker.drain;
          assert.deepStrictEqual(
            (yield* projectionOf(harness, working)).runs.map((run) => run.status),
            ["cancelled"],
          );
          // A removed project takes no new threads.
          const refusedThread = yield* Effect.flip(
            createThread(harness, projectId, ThreadId.make("thread:late")),
          );
          assert.strictEqual(refusedThread.message, `Project ${projectId} does not exist.`);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "a removal cut short after its first thread is finished by sending it again after a restart, deleting each thread once",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const config = yield* makeTestServerConfig();
          const recorded = yield* readRecording("file_create.claude.ndjson");
          const replay = yield* makeClaudeReplay(
            yield* materializeReplayWorkspace(recorded, path.join(config.baseDir, "unused")),
          );
          const before = yield* makeOrchestrationHarness({ claudeRunner: replay.runner, config });
          const projectId = ProjectId.make("project:space-game");
          yield* addProject(before, "space-game", yield* makeGameFolder(before, "space-game"));
          const first = ThreadId.make("thread:first");
          const second = ThreadId.make("thread:second");
          yield* createThread(before, projectId, first);
          yield* createThread(before, projectId, second);
          const removal = { commandId: CommandId.make("command:remove"), projectId, force: true };
          // What the removal had done when the server stopped: its first thread's deletion.
          yield* dispatch(before, {
            type: "thread.delete",
            commandId: CommandId.make(`command:remove:delete-thread:${first}`),
            threadId: first,
          });

          const harness = yield* makeOrchestrationHarness({ claudeRunner: replay.runner, config });
          assert.deepStrictEqual(yield* listedIds(harness), [projectId]);
          const removed = yield* harness.projects.delete(removal);

          assert.strictEqual(removed.id, projectId);
          assert.deepStrictEqual(yield* listedIds(harness), []);
          const expected: Array<[string, string, string | null]> = [
            [first, "thread.deleted", `command:remove:delete-thread:${first}`],
            [second, "thread.deleted", `command:remove:delete-thread:${second}`],
            [projectId, "project.deleted", "command:remove"],
          ];
          assert.deepStrictEqual(yield* removals(harness), expected);

          // Sent again it gets the same project back and changes nothing; a new removal is refused.
          assert.deepStrictEqual(yield* harness.projects.delete(removal), removed);
          assert.deepStrictEqual(yield* removals(harness), expected);
          const again = yield* Effect.flip(
            harness.projects.delete({ ...removal, commandId: CommandId.make("command:again") }),
          );
          assert.strictEqual(again._tag, "ProjectNotFoundError");
        }).pipe(Effect.scoped),
    );
  });
});

describe("Rename a project", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("renaming changes the title and keeps the folder; a removed project is refused", () =>
      Effect.gen(function* () {
        const harness = yield* makeOrchestrationHarness({});
        const folder = yield* makeGameFolder(harness, "space-game");
        const projectId = ProjectId.make("project:space-game");
        yield* addProject(harness, "space-game", folder);

        const renamed = yield* harness.projects.update({
          commandId: CommandId.make("command:rename"),
          projectId,
          title: "Moon Jumper",
        });

        assert.strictEqual(renamed.title, "Moon Jumper");
        assert.strictEqual(renamed.workspaceRoot, folder);
        assert.deepStrictEqual(
          (yield* harness.projects.listShells).map((shell) => [shell.title, shell.workspaceRoot]),
          [["Moon Jumper", folder]],
        );

        yield* harness.projects.delete({ commandId: CommandId.make("command:remove"), projectId });
        const refused = yield* Effect.flip(
          harness.projects.update({
            commandId: CommandId.make("command:rename-again"),
            projectId,
            title: "Too late",
          }),
        );
        assert.strictEqual(refused._tag, "ProjectNotFoundError");
      }).pipe(Effect.scoped),
    );
  });
});

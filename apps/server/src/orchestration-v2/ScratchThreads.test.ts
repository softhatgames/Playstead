import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { ThreadTitleGenerationInput } from "@playstead/provider-core/server/textGeneration";
import { materializeReplayWorkspace } from "@playstead/provider-testing/replayTranscript";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { makeTestServerConfig } from "../testUtils/testServer.ts";
import type * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { makeClaudeReplay } from "./Adapters/ClaudeAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import { FILE_CREATE_SCENARIO } from "./testkit/fixtures/fileCreate.ts";
import { readRecording } from "./testkit/ProviderReplay.ts";

/**
 * Seam 1 for threads without a project (T3 Code's `ThreadLaunchService.test.ts`
 * "runs a Scratch thread launched at the root in its own folder" at
 * 2577baf): the real orchestrator, effect worker, project service and
 * managed folders, with Claude's transport replaying the file-create
 * recording in the folder the thread should get. The replay compares the
 * session's working directory with that folder strictly.
 */

const threadId = ThreadId.make("thread:scratch");
const modelSelection = {
  instanceId: FILE_CREATE_SCENARIO.instanceId,
  model: FILE_CREATE_SCENARIO.model,
};
const sendFirstMessage = {
  type: "message.dispatch",
  dispatchMode: { type: "start_immediately" },
  commandId: CommandId.make("command:scratch:message"),
  threadId,
  messageId: MessageId.make("message:scratch:1"),
  text: FILE_CREATE_SCENARIO.prompt,
  titleSeed: FILE_CREATE_SCENARIO.titleSeed,
} as const;

describe("Threads without a project", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("a thread without a project runs in its own folder, which outlives the thread", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* makeTestServerConfig();
        const scratchRoot = path.resolve(config.baseDir, "scratch");
        // The test clock's date, the message's first five words and the
        // thread id's last eight characters.
        const folder = path.join(scratchRoot, "1970-01-01-use-your-write-tool-not-dscratch");
        const replay = yield* makeClaudeReplay(
          yield* materializeReplayWorkspace(
            yield* readRecording("file_create.claude.ndjson"),
            folder,
          ),
        );
        const titleRequests: Array<ThreadTitleGenerationInput> = [];
        const textGeneration: TextGeneration.TextGeneration["Service"] = {
          generateThreadTitle: (input) =>
            Effect.sync(() => {
              titleRequests.push(input);
              return { title: "Write a hello file" };
            }),
        };
        const harness = yield* makeOrchestrationHarness({
          claudeRunner: replay.runner,
          textGeneration,
          config,
        });

        const { projectId } = yield* harness.projects.ensureScratchProject;
        yield* harness.orchestrator.dispatch({
          type: "thread.create",
          runtimeMode: "full-access",
          commandId: CommandId.make("command:scratch:thread"),
          threadId,
          projectId,
          title: "New thread",
          modelSelection,
        });
        const sent = yield* harness.orchestrator.dispatch(sendFirstMessage);
        // Sent again, the message claims no second folder.
        yield* harness.orchestrator.dispatch(sendFirstMessage);
        yield* harness.worker.drain;
        const run = yield* harness.awaitRunEnded(threadId, sent.sequence);

        assert.strictEqual(run.status, "completed");
        yield* replay.assertComplete;
        const projection = Option.getOrThrow(
          yield* harness.orchestrator.getThreadProjection(threadId),
        );
        assert.strictEqual(projection.thread.worktreePath, folder);
        assert.strictEqual(projection.thread.title, "Write a hello file");
        assert.deepStrictEqual(
          titleRequests.map((request) => request.cwd),
          [folder],
        );
        assert.deepStrictEqual(yield* fs.readDirectory(scratchRoot), [path.basename(folder)]);

        yield* harness.orchestrator.dispatch({
          type: "thread.delete",
          commandId: CommandId.make("command:scratch:delete"),
          threadId,
        });
        assert.isTrue(yield* fs.exists(folder));
      }).pipe(Effect.scoped),
    );

    it.effect("a thread in a project of its own gets no folder", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* makeTestServerConfig();
        const workspaceRoot = path.join(config.baseDir, "space-game");
        // The turn is never started; the replay only lets Claude's threads be created.
        const replay = yield* makeClaudeReplay(
          yield* materializeReplayWorkspace(
            yield* readRecording("file_create.claude.ndjson"),
            workspaceRoot,
          ),
        );
        const harness = yield* makeOrchestrationHarness({ claudeRunner: replay.runner, config });
        yield* harness.projects.ensureScratchProject;
        yield* harness.projects.create({
          commandId: CommandId.make("command:space-game"),
          projectId: ProjectId.make("project:space-game"),
          title: "space-game",
          workspaceRoot,
          createWorkspaceRootIfMissing: true,
        });
        yield* harness.orchestrator.dispatch({
          type: "thread.create",
          runtimeMode: "full-access",
          commandId: CommandId.make("command:space-game:thread"),
          threadId,
          projectId: ProjectId.make("project:space-game"),
          title: "New thread",
          modelSelection,
        });
        yield* harness.orchestrator.dispatch(sendFirstMessage);

        const projection = Option.getOrThrow(
          yield* harness.orchestrator.getThreadProjection(threadId),
        );
        assert.isNull(projection.thread.worktreePath);
        assert.deepStrictEqual(yield* fs.readDirectory(path.resolve(harness.home, "scratch")), []);
      }).pipe(Effect.scoped),
    );
  });
});

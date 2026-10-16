import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId } from "@playstead/contracts/baseSchemas";
import { OrchestrationDispatchCommandError } from "@playstead/contracts/orchestrationV2";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
} from "@playstead/provider-testing/replayTranscript";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { makeClaudeReplay } from "./Adapters/ClaudeAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import {
  FILE_CREATE_IDS,
  FILE_CREATE_SCENARIO,
  runFileCreateScenario,
} from "./testkit/fixtures/fileCreate.ts";

/**
 * Seam 1 over Playstead's recording of the signed-in Claude: the real
 * orchestrator, event sink, effect worker, Claude adapter, projections and
 * SQLite, with only `query()`, the clock and randomness stood in for.
 */
const replayFileCreate = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const recordingPath = path.join(
    path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
    "testkit",
    "fixtures",
    "file_create.claude.ndjson",
  );
  const recorded = yield* decodeProviderReplayNdjson(yield* fs.readFileString(recordingPath));
  // The workspace is the harness's own folder, known only once it exists.
  let replay: Effect.Success<ReturnType<typeof makeClaudeReplay>> | undefined;
  const harness = yield* makeOrchestrationHarness({
    claudeRunner: {
      allocateSessionId: Effect.suspend(() => replay!.runner.allocateSessionId),
      open: (input) => Effect.suspend(() => replay!.runner.open(input)),
    },
  });
  replay = yield* makeClaudeReplay(
    materializeReplayWorkspace(recorded, path.join(harness.home, "empty-game")),
  );
  return { harness, replay: replay! };
});

describe("Chat with Claude in a thread", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("a file-creating turn completes with the file's name and content", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const { harness, replay } = yield* replayFileCreate;

        const { workspace, run } = yield* runFileCreateScenario(harness);

        yield* replay.assertComplete;
        assert.strictEqual(run.status, "completed");
        const projection = Option.getOrThrow(
          yield* harness.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
        );
        assert.strictEqual(projection.thread.title, FILE_CREATE_SCENARIO.titleSeed);
        assert.deepStrictEqual(
          projection.runs.map((candidate) => candidate.status),
          ["completed"],
        );
        const fileChanges = projection.turnItems.filter((item) => item.type === "file_change");
        assert.deepStrictEqual(
          fileChanges.map((item) => ({
            status: item.status,
            fileName: item.fileName,
            newStr: item.newStr?.trim(),
          })),
          [
            {
              status: "completed",
              fileName: path.join(workspace, FILE_CREATE_SCENARIO.fileName),
              newStr: FILE_CREATE_SCENARIO.content,
            },
          ],
        );
        assert.strictEqual(projection.turnItems[0]?.type, "user_message");
        const reply = projection.turnItems.findLast((item) => item.type === "assistant_message");
        assert.isDefined(reply);
        assert.isFalse(reply.type === "assistant_message" && reply.streaming);
      }).pipe(Effect.scoped),
    );

    it.effect("refuses a message while the thread's run is active", () =>
      Effect.gen(function* () {
        const { harness, replay } = yield* replayFileCreate;
        const sendAgain = {
          type: "message.dispatch",
          commandId: CommandId.make("command:file-create:too-soon"),
          threadId: FILE_CREATE_IDS.threadId,
          messageId: MessageId.make("message:file-create:too-soon"),
          text: "And another file, please.",
        } as const;

        // Sent while the first run is still starting: the effect worker has
        // not started the turn yet. T3 Code would queue it.
        const { run, interjected } = yield* runFileCreateScenario(
          harness,
          Effect.flip(harness.orchestrator.dispatch(sendAgain)),
        );

        assert.instanceOf(interjected, OrchestrationDispatchCommandError);
        assert.match(interjected.message, /is still working on run .+\. Wait for it to finish/);
        // The same command sent again gets its first answer, not a new decision.
        const again = yield* Effect.flip(harness.orchestrator.dispatch(sendAgain));
        assert.strictEqual(again.message, interjected.message);
        const projection = Option.getOrThrow(
          yield* harness.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
        );
        assert.deepStrictEqual(
          projection.messages
            .filter((message) => message.role === "user")
            .map((message) => message.id),
          [FILE_CREATE_IDS.messageId],
        );
        yield* replay.assertComplete;
        assert.strictEqual(run.status, "completed");
      }).pipe(Effect.scoped),
    );
  });
});

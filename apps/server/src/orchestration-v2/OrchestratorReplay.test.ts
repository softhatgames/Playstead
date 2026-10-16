import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId } from "@playstead/contracts/baseSchemas";
import { OrchestrationDispatchCommandError } from "@playstead/contracts/orchestrationV2";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
  type ProviderReplayEntry,
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
 * `followedBy` are frames the adapter must send after the recorded turn;
 * `beforeTurn` are messages Claude sends right after the prompt, before
 * the recorded turn's.
 */
const replayFileCreate = (
  followedBy: ReadonlyArray<ProviderReplayEntry> = [],
  beforeTurn: ReadonlyArray<ProviderReplayEntry> = [],
) =>
  Effect.gen(function* () {
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
      materializeReplayWorkspace(
        {
          ...recorded,
          entries: [
            ...recorded.entries.slice(0, 2),
            ...beforeTurn,
            ...recorded.entries.slice(2),
            ...followedBy,
          ],
        },
        path.join(harness.home, "empty-game"),
      ),
    );
    return { harness, replay: replay! };
  });

describe("Chat with Claude in a thread", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("a file-creating turn completes with the file's name and content", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const { harness, replay } = yield* replayFileCreate();

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

    it.effect("a turn Claude Code runs by itself does not end the person's turn", () =>
      Effect.gen(function* () {
        // Claude Code's own turn after a background command finished, as
        // Claude 2.1.301 sent it (seen by hand): its frames carry no
        // prompt's uuid, and it ends with a result of its own.
        const sessionId = "c4aedb90-2046-46ac-b9bb-bfc68d7d8381";
        const ownTurn = "The background `sleep 15` finished with exit code 0.";
        const { harness, replay } = yield* replayFileCreate(
          [],
          [
            { type: "system", subtype: "init", session_id: sessionId },
            {
              type: "assistant",
              message: {
                id: "msg_background",
                role: "assistant",
                content: [{ type: "text", text: ownTurn }],
              },
              parent_tool_use_id: null,
              session_id: sessionId,
            },
            {
              type: "result",
              subtype: "success",
              is_error: false,
              result: ownTurn,
              result_index: 0,
              terminal_reason: "completed",
              session_id: sessionId,
            },
          ].map((frame) => ({ type: "emit_inbound" as const, frame })),
        );

        const { run } = yield* runFileCreateScenario(harness);

        yield* replay.assertComplete;
        assert.strictEqual(run.status, "completed");
        const projection = Option.getOrThrow(
          yield* harness.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
        );
        const replies = projection.turnItems.flatMap((item) =>
          item.type === "assistant_message" ? [item.text] : [],
        );
        assert.notInclude(replies, ownTurn);
        assert.deepStrictEqual(
          projection.turnItems.filter((item) => item.type === "file_change").length,
          1,
        );
      }).pipe(Effect.scoped),
    );

    it.effect("refuses a message while the thread's run is active", () =>
      Effect.gen(function* () {
        const { harness, replay } = yield* replayFileCreate();
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

    it.effect("after a model change, the next turn asks Claude for the new model", () =>
      Effect.gen(function* () {
        const followUp = "Now say hello in one word.";
        // The recording holds one turn; the frames after it are what the
        // adapter must send for the next. Claude's answer is not recorded,
        // so the replay ends there.
        const { harness, replay } = yield* replayFileCreate([
          {
            type: "expect_outbound",
            frame: { type: "query.set_model", model: "claude-sonnet-5-5" },
          },
          {
            type: "expect_outbound",
            frame: {
              type: "prompt.offer",
              message: {
                type: "user",
                message: { role: "user", content: followUp },
                parent_tool_use_id: null,
                // Any uuid: the replay pairs it with the one the adapter sends.
                uuid: "00000000-0000-4000-8000-000000000002",
              },
            },
          },
        ]);
        yield* runFileCreateScenario(harness);

        yield* harness.orchestrator.dispatch({
          type: "thread.model-selection.set",
          commandId: CommandId.make("command:file-create:model"),
          threadId: FILE_CREATE_IDS.threadId,
          modelSelection: { instanceId: "claudeAgent", model: "claude-sonnet-5-5" },
        });
        const sent = yield* harness.orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("command:file-create:follow-up"),
          threadId: FILE_CREATE_IDS.threadId,
          messageId: MessageId.make("message:file-create:2"),
          text: followUp,
        });
        yield* harness.worker.drain;
        yield* harness.awaitRunEnded(FILE_CREATE_IDS.threadId, sent.sequence);

        yield* replay.assertComplete;
        const projection = Option.getOrThrow(
          yield* harness.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
        );
        assert.deepStrictEqual(projection.thread.modelSelection, {
          instanceId: "claudeAgent",
          model: "claude-sonnet-5-5",
        });
        assert.deepStrictEqual(
          projection.runs.map((run) => run.modelSelection.model),
          ["claude-haiku-5-5", "claude-sonnet-5-5"],
        );
        assert.deepStrictEqual(
          projection.providerSessions.map((session) => session.model),
          ["claude-sonnet-5-5"],
        );
      }).pipe(Effect.scoped),
    );

    it.effect("refuses a model change that names another provider instance", () =>
      Effect.gen(function* () {
        const { harness, replay } = yield* replayFileCreate();
        yield* runFileCreateScenario(harness);

        const refused = yield* Effect.flip(
          harness.orchestrator.dispatch({
            type: "thread.model-selection.set",
            commandId: CommandId.make("command:file-create:switch-provider"),
            threadId: FILE_CREATE_IDS.threadId,
            modelSelection: { instanceId: "codex", model: "gpt-5.5" },
          }),
        );

        assert.instanceOf(refused, OrchestrationDispatchCommandError);
        assert.strictEqual(
          refused.message,
          "Thread thread:file-create runs on claudeAgent. Choose one of its models; switching provider is not available yet.",
        );
        const projection = Option.getOrThrow(
          yield* harness.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
        );
        assert.deepStrictEqual(projection.thread.modelSelection, {
          instanceId: "claudeAgent",
          model: "claude-haiku-5-5",
        });
        yield* replay.assertComplete;
      }).pipe(Effect.scoped),
    );
  });
});

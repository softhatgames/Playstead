import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId } from "@playstead/contracts/baseSchemas";
import { OrchestrationDispatchCommandError } from "@playstead/contracts/orchestrationV2";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
  type ProviderReplayTranscript,
} from "@playstead/provider-testing/replayTranscript";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { makeCodexReplay } from "./Adapters/CodexAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import {
  CODEX_FILE_CREATE_SCENARIO,
  FILE_CREATE_IDS,
  runProviderFileCreateScenario,
} from "./testkit/fixtures/fileCreate.ts";

/**
 * Seam 1 over Playstead's recording of the signed-in Codex: the real
 * orchestrator, event sink, effect worker, Codex adapter and Codex
 * app-server client, projections and SQLite, with only Codex's stdio, the
 * clock and randomness stood in for. Every frame the adapter sends is
 * compared with the recording, Full access's approval and sandbox settings
 * included, so a wrong mapping fails the replay.
 */
const readRecording = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const recordingPath = path.join(
    path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
    "testkit",
    "fixtures",
    "file_create.codex.ndjson",
  );
  return yield* decodeProviderReplayNdjson(yield* fs.readFileString(recordingPath));
});

const replayFileCreate = (
  edit: (recording: ProviderReplayTranscript) => ProviderReplayTranscript = (recording) =>
    recording,
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const recorded = edit(yield* readRecording);
    // The workspace is the harness's own folder, known only once it exists.
    let replay: Effect.Success<ReturnType<typeof makeCodexReplay>> | undefined;
    const harness = yield* makeOrchestrationHarness({
      codexClients: { open: (input) => Effect.suspend(() => replay!.clients.open(input)) },
    });
    replay = yield* makeCodexReplay(
      yield* materializeReplayWorkspace(recorded, path.join(harness.home, "empty-game")),
    );
    return { harness, replay: replay! };
  });

describe("Chat with Codex in a thread", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "a file-creating turn in Full access completes with the file's name and content",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const { harness, replay } = yield* replayFileCreate();

          const { workspace, run } = yield* runProviderFileCreateScenario(
            harness,
            CODEX_FILE_CREATE_SCENARIO,
          );

          yield* replay.assertComplete;
          assert.strictEqual(run.status, "completed");
          const projection = Option.getOrThrow(
            yield* harness.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
          );
          assert.strictEqual(projection.thread.title, CODEX_FILE_CREATE_SCENARIO.titleSeed);
          assert.strictEqual(projection.thread.providerInstanceId, "codex");
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
                fileName: path.join(workspace, CODEX_FILE_CREATE_SCENARIO.fileName),
                newStr: CODEX_FILE_CREATE_SCENARIO.content,
              },
            ],
          );
          assert.strictEqual(projection.turnItems[0]?.type, "user_message");
          const reply = projection.turnItems.findLast((item) => item.type === "assistant_message");
          assert.isDefined(reply);
          assert.strictEqual(reply.type, "assistant_message");
          if (reply.type !== "assistant_message") return;
          assert.isAbove(reply.text.trim().length, 0);
          assert.isFalse(reply.streaming);
          // The reply streamed in: the thread saw it grow before it was whole.
          const latest = yield* harness.eventStore.latestApplicationSequence;
          const stored = yield* harness.eventStore
            .streamApplicationEvents({ afterSequence: 0 })
            .pipe(
              Stream.takeUntil((event) => event.sequence >= latest),
              Stream.runCollect,
            );
          const streamedReply = stored.flatMap((event) =>
            event.aggregateKind === "thread" &&
            event.event.type === "message.updated" &&
            event.event.payload.id === reply.messageId &&
            event.event.payload.streaming
              ? [event.event.payload.text]
              : [],
          );
          assert.isAbove(streamedReply.length, 1);
          assert.isTrue(reply.text.startsWith(streamedReply[0]!));
        }).pipe(Effect.scoped),
    );

    it.effect("a replay fails when Full access is sent with other Codex settings", () =>
      Effect.gen(function* () {
        // The recording as if Full access were Codex's workspace-write sandbox:
        // the adapter's real `turn/start` no longer matches it.
        const { harness, replay } = yield* replayFileCreate((recording) => ({
          ...recording,
          entries: recording.entries.map((entry) => {
            const frame = entry.frame as { method?: unknown; params?: Record<string, unknown> };
            return entry.type === "expect_outbound" && frame.method === "turn/start"
              ? {
                  ...entry,
                  frame: {
                    ...frame,
                    params: { ...frame.params, sandboxPolicy: { type: "workspaceWrite" } },
                  },
                }
              : entry;
          }),
        }));

        const { run } = yield* runProviderFileCreateScenario(harness, CODEX_FILE_CREATE_SCENARIO);

        assert.strictEqual(run.status, "failed");
        const mismatch = yield* Effect.flip(replay.assertComplete);
        assert.strictEqual(mismatch._tag, "CodexAppServerReplayFrameMismatchError");
      }).pipe(Effect.scoped),
    );

    it.effect("refuses a Codex thread when Codex cannot run threads", () =>
      Effect.gen(function* () {
        // No seam to Codex, so no Codex adapter.
        const harness = yield* makeOrchestrationHarness({});
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const folder = path.join(harness.home, "empty-game");
        yield* fs.makeDirectory(folder);
        yield* harness.projects.create({
          commandId: CommandId.make("command:codex-absent:project"),
          projectId: FILE_CREATE_IDS.projectId,
          title: "empty-game",
          workspaceRoot: folder,
        });

        const refused = yield* Effect.flip(
          harness.orchestrator.dispatch({
            type: "thread.create",
            commandId: CommandId.make("command:codex-absent:thread"),
            threadId: FILE_CREATE_IDS.threadId,
            projectId: FILE_CREATE_IDS.projectId,
            title: "New thread",
            modelSelection: { instanceId: "codex", model: CODEX_FILE_CREATE_SCENARIO.model },
            runtimeMode: "full-access",
          }),
        );

        assert.instanceOf(refused, OrchestrationDispatchCommandError);
        assert.match(refused.message, /codex cannot run threads/);
      }).pipe(Effect.scoped),
    );
  });
});

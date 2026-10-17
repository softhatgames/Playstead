import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId, ThreadId } from "@playstead/contracts/baseSchemas";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
} from "@playstead/provider-testing/replayTranscript";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import { makeTestServerConfig } from "../testUtils/testServer.ts";
import { makeClaudeReplay } from "./Adapters/ClaudeAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import {
  FILE_CREATE_IDS,
  FILE_CREATE_SCENARIO,
  sendFileCreateMessage,
} from "./testkit/fixtures/fileCreate.ts";

describe("Thread search at the orchestration boundary", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "prefers user messages, ranks them before assistant-only threads, and excludes archived/deleted threads",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const config = yield* makeTestServerConfig();
          const recording = yield* decodeProviderReplayNdjson(
            yield* fs.readFileString(
              path.join(
                path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
                "testkit",
                "fixtures",
                "file_create.claude.ndjson",
              ),
            ),
          );
          const replay = yield* makeClaudeReplay(
            yield* materializeReplayWorkspace(recording, path.join(config.baseDir, "empty-game")),
          );
          const harness = yield* makeOrchestrationHarness({ config, claudeRunner: replay.runner });
          const { sent } = yield* sendFileCreateMessage(harness);
          yield* harness.worker.drain;
          yield* harness.awaitRunEnded(FILE_CREATE_IDS.threadId, sent.sequence);
          yield* replay.assertComplete;
          const both = yield* harness.search.search({ query: "hello-claude" });
          assert.strictEqual(both.matches.length, 1);
          assert.strictEqual(both.matches[0]?.source, "user");
          const assistant = yield* harness.search.search({ query: "Created `" });
          assert.strictEqual(assistant.matches[0]?.source, "assistant");
          assert.include(assistant.matches[0]?.snippet, "Created `hello-claude.txt`");

          const threadId = ThreadId.make("thread:other");
          yield* harness.orchestrator.dispatch({
            type: "thread.create",
            commandId: CommandId.make("other:create"),
            threadId,
            projectId: FILE_CREATE_IDS.projectId,
            title: "Other",
            modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
          });
          yield* harness.orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("other:send"),
            threadId,
            messageId: MessageId.make("other:message"),
            text: "Created `another file`",
          });
          // Even a more recently updated assistant match ranks behind a user match.
          yield* TestClock.adjust("1 second");
          yield* harness.orchestrator.dispatch({
            type: "thread.metadata.update",
            commandId: CommandId.make("rename-later"),
            threadId: FILE_CREATE_IDS.threadId,
            title: "More recent assistant match",
          });
          assert.deepStrictEqual(
            (yield* harness.search.search({ query: "Created `" })).matches.map(
              (match) => match.threadId,
            ),
            [threadId, FILE_CREATE_IDS.threadId],
          );
          assert.deepStrictEqual(
            (yield* harness.search.search({ query: "Created `", limit: 1 })).matches.map(
              (match) => match.threadId,
            ),
            [threadId],
          );
          yield* harness.orchestrator.dispatch({
            type: "thread.archive",
            commandId: CommandId.make("archive"),
            threadId: FILE_CREATE_IDS.threadId,
          });
          assert.deepStrictEqual(yield* harness.search.search({ query: "hello-claude" }), {
            matches: [],
          });
          yield* harness.orchestrator.dispatch({
            type: "thread.unarchive",
            commandId: CommandId.make("unarchive"),
            threadId: FILE_CREATE_IDS.threadId,
          });
          assert.strictEqual(
            (yield* harness.search.search({ query: "hello-claude" })).matches.length,
            1,
          );
          yield* harness.orchestrator.dispatch({
            type: "thread.delete",
            commandId: CommandId.make("delete"),
            threadId: FILE_CREATE_IDS.threadId,
          });
          assert.deepStrictEqual(yield* harness.search.search({ query: "hello-claude" }), {
            matches: [],
          });
        }).pipe(Effect.scoped),
    );
    it.effect("does not search an assistant message while it is still streaming", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* makeTestServerConfig();
        const recording = yield* decodeProviderReplayNdjson(
          yield* fs.readFileString(
            path.join(
              path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
              "testkit",
              "fixtures",
              "file_create.claude.ndjson",
            ),
          ),
        );
        const replay = yield* makeClaudeReplay(
          yield* materializeReplayWorkspace(recording, path.join(config.baseDir, "empty-game")),
          {
            holdBefore: (frame) =>
              JSON.stringify(frame).includes('"type":"assistant"') &&
              JSON.stringify(frame).includes("Created `hello-claude.txt`"),
          },
        );
        const harness = yield* makeOrchestrationHarness({ config, claudeRunner: replay.runner });
        const { sent } = yield* sendFileCreateMessage(harness);
        yield* harness.worker.drain;
        yield* replay.awaitHeld;
        // Await the persisted streaming update, not the provider's emission.
        yield* harness.eventStore.streamApplicationEvents({ afterSequence: sent.sequence }).pipe(
          Stream.filter(
            (stored) =>
              stored.aggregateKind === "thread" &&
              JSON.stringify(stored.event).includes("Created `"),
          ),
          Stream.runHead,
        );
        const projection = Option.getOrThrow(
          yield* harness.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
        );
        assert.isTrue(
          projection.messages.some(
            (message) => message.streaming && message.text.includes("Created `"),
          ),
        );
        assert.deepStrictEqual(yield* harness.search.search({ query: "Created `" }), {
          matches: [],
        });
      }).pipe(Effect.scoped),
    );
    it.effect("returns a bounded, whitespace-normalized snippet around a literal match", () =>
      Effect.gen(function* () {
        const harness = yield* makeOrchestrationHarness({
          claudeRunner: {
            allocateSessionId: Effect.succeed("search-session"),
            open: () => Effect.die("No provider turn should start"),
          },
        });
        yield* sendFileCreateMessage(harness, {
          ...FILE_CREATE_SCENARIO,
          prompt: "prefix ".repeat(80) + "100%_! MATCH\ncontext " + "suffix ".repeat(80),
        });
        const result = yield* harness.search.search({ query: "100%_!" });
        assert.strictEqual(result.matches.length, 1);
        const snippet = result.matches[0]!.snippet;
        assert.isAtMost(snippet.length, 240);
        assert.include(snippet, "100%_! MATCH context");
        assert.isTrue(snippet.startsWith("…"));
        assert.isTrue(snippet.endsWith("…"));
        assert.deepStrictEqual(yield* harness.search.search({ query: "100__!" }), { matches: [] });
      }).pipe(Effect.scoped),
    );

    it.effect("finds a persisted user message once, without matching the title", () =>
      Effect.gen(function* () {
        const harness = yield* makeOrchestrationHarness({
          claudeRunner: {
            allocateSessionId: Effect.succeed("search-session"),
            open: () => Effect.die("No provider turn should start"),
          },
        });
        yield* sendFileCreateMessage(harness);
        const result = yield* harness.search.search({ query: "HELLO-CLAUDE" });
        assert.strictEqual(result.matches.length, 1);
        assert.strictEqual(result.matches[0]?.threadId, FILE_CREATE_IDS.threadId);
        assert.strictEqual(result.matches[0]?.source, "user");
        assert.include(result.matches[0]?.snippet, "hello-claude.txt");
        assert.deepStrictEqual(yield* harness.search.search({ query: "New thread" }), {
          matches: [],
        });
      }).pipe(Effect.scoped),
    );
  });
});

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId, ThreadId } from "@playstead/contracts/baseSchemas";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
} from "@playstead/provider-testing/replayTranscript";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { makeTestServerConfig } from "../testUtils/testServer.ts";
import { makeClaudeReplay } from "./Adapters/ClaudeAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import {
  FILE_CREATE_IDS,
  FILE_CREATE_SCENARIO,
  runFileCreateScenario,
  sendFileCreateMessage,
} from "./testkit/fixtures/fileCreate.ts";

/**
 * Seam 1 for searching threads' messages (T3 Code's
 * `apps/server/src/orchestration-v2/ThreadSearch.ts` at 2577baf): the real
 * orchestrator and projections, with Claude's transport replaying the
 * file-create recording for a finished reply. Other threads get only the
 * person's messages, which are finished as soon as they are sent.
 */

const readRecording = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(
      path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
      "testkit",
      "fixtures",
      name,
    );
    return yield* decodeProviderReplayNdjson(yield* fs.readFileString(file));
  });

const makeHarness = (options?: Parameters<typeof makeClaudeReplay>[1]) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const config = yield* makeTestServerConfig();
    const recorded = yield* readRecording("file_create.claude.ndjson");
    const replay = yield* makeClaudeReplay(
      yield* materializeReplayWorkspace(recorded, path.join(config.baseDir, "empty-game")),
      options,
    );
    const harness = yield* makeOrchestrationHarness({ claudeRunner: replay.runner, config });
    return { harness, replay };
  });

type Harness = Effect.Success<ReturnType<typeof makeHarness>>["harness"];

const REPLY =
  'Created `hello-claude.txt` in the working directory with the line "Hello from Claude in Playstead!"';

const search = (harness: Harness, query: string, limit?: number) =>
  Effect.map(
    harness.threadSearch.search(limit === undefined ? { query } : { query, limit }),
    (result) => result.matches.map((match) => [match.threadId, match.source, match.snippet]),
  );

describe("Search threads", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("a finished reply is found, with the reply as its snippet", () =>
      Effect.gen(function* () {
        const { harness } = yield* makeHarness();
        yield* runFileCreateScenario(harness);
        assert.deepStrictEqual(yield* search(harness, "CREATED `hello"), [
          [FILE_CREATE_IDS.threadId, "assistant", REPLY],
        ]);
      }).pipe(Effect.scoped),
    );

    it.effect("a reply still being written is not searched", () =>
      Effect.gen(function* () {
        const { harness, replay } = yield* makeHarness({
          holdBefore: (frame) => JSON.stringify(frame).includes('"text":" Playstead!\\""'),
        });
        const { sent } = yield* sendFileCreateMessage(harness);
        yield* harness.worker.drain;
        yield* replay.awaitHeld;
        // The reply so far has reached the thread, unfinished.
        yield* harness.eventStore.streamApplicationEvents({ afterSequence: sent.sequence }).pipe(
          Stream.filter(
            (stored) =>
              stored.aggregateKind === "thread" &&
              stored.event.type === "message.updated" &&
              stored.event.payload.role === "assistant" &&
              stored.event.payload.streaming &&
              stored.event.payload.text.includes("working directory with the line"),
          ),
          Stream.runHead,
        );
        assert.deepStrictEqual(yield* search(harness, "created `hello"), []);
      }).pipe(Effect.scoped),
    );

    it.effect(
      "each thread gives one match, the person's words before the agent's, and threads where the person said it come first",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* makeHarness();
          yield* runFileCreateScenario(harness);
          // Said by both: the person's message is the thread's match.
          assert.deepStrictEqual(yield* search(harness, "write tool"), [
            [FILE_CREATE_IDS.threadId, "user", FILE_CREATE_SCENARIO.prompt],
          ]);

          yield* TestClock.adjust("1 minute");
          const older = yield* sendUserMessages(harness, "older", [
            "Created levels need a hello-claude.txt too",
          ]);
          yield* TestClock.adjust("1 minute");
          const newer = yield* sendUserMessages(harness, "newer", ["Read hello-claude.txt aloud"]);
          yield* TestClock.adjust("1 minute");
          // The file-create thread is now the most recently active, with a
          // second message from the person.
          yield* harness.orchestrator.dispatch({
            type: "message.dispatch",
            dispatchMode: { type: "start_immediately" },
            commandId: CommandId.make("command:file-create:message:2"),
            threadId: FILE_CREATE_IDS.threadId,
            messageId: MessageId.make("message:file-create:2"),
            text: "Rename hello-claude.txt to notes.txt",
          });

          assert.deepStrictEqual(yield* search(harness, "hello-claude.txt"), [
            // Its newest matching message.
            [FILE_CREATE_IDS.threadId, "user", "Rename hello-claude.txt to notes.txt"],
            [newer, "user", "Read hello-claude.txt aloud"],
            [older, "user", "Created levels need a hello-claude.txt too"],
          ]);
          assert.deepStrictEqual(yield* search(harness, "hello-claude.txt", 2), [
            [FILE_CREATE_IDS.threadId, "user", "Rename hello-claude.txt to notes.txt"],
            [newer, "user", "Read hello-claude.txt aloud"],
          ]);
          // The person's words outrank the agent's, even in a thread less recently active.
          assert.deepStrictEqual(yield* search(harness, "created"), [
            [older, "user", "Created levels need a hello-claude.txt too"],
            [FILE_CREATE_IDS.threadId, "assistant", REPLY],
          ]);
        }).pipe(Effect.scoped),
    );

    it.effect("archived and deleted threads are not searched, and unarchived ones are again", () =>
      Effect.gen(function* () {
        const { harness } = yield* makeHarness();
        yield* runFileCreateScenario(harness);
        const archived = yield* sendUserMessages(harness, "archived", ["A comet tail"]);
        const deleted = yield* sendUserMessages(harness, "deleted", ["A comet shower"]);
        const lifecycle =
          (type: "thread.archive" | "thread.unarchive" | "thread.delete") => (threadId: ThreadId) =>
            harness.orchestrator.dispatch({
              type,
              commandId: CommandId.make(`command:${type}:${threadId}`),
              threadId,
            });
        yield* lifecycle("thread.archive")(archived);
        yield* lifecycle("thread.delete")(deleted);
        assert.deepStrictEqual(yield* search(harness, "comet"), []);

        yield* lifecycle("thread.unarchive")(archived);
        assert.deepStrictEqual(yield* search(harness, "comet"), [
          [archived, "user", "A comet tail"],
        ]);
      }).pipe(Effect.scoped),
    );

    it.effect("threads of a removed project are not searched", () =>
      Effect.gen(function* () {
        const { harness } = yield* makeHarness();
        yield* runFileCreateScenario(harness);
        yield* sendUserMessages(harness, "doomed", ["A comet tail"]);
        assert.lengthOf(yield* search(harness, "comet"), 1);

        yield* harness.projects.delete({
          commandId: CommandId.make("command:remove-project"),
          projectId: FILE_CREATE_IDS.projectId,
          force: true,
        });

        assert.deepStrictEqual(yield* search(harness, "comet"), []);
        assert.deepStrictEqual(yield* search(harness, "hello"), []);
      }).pipe(Effect.scoped),
    );

    it.effect("the query matches as typed, with no wildcards", () =>
      Effect.gen(function* () {
        const { harness } = yield* makeHarness();
        yield* runFileCreateScenario(harness);
        const threadId = yield* sendUserMessages(harness, "wildcards", [
          "Speed up by 100% on level_2!",
        ]);
        assert.deepStrictEqual(yield* search(harness, "y 1%2"), []);
        assert.deepStrictEqual(yield* search(harness, "level_"), [
          [threadId, "user", "Speed up by 100% on level_2!"],
        ]);
        assert.deepStrictEqual(yield* search(harness, "l_v"), []);
        assert.deepStrictEqual(yield* search(harness, "0% on"), [
          [threadId, "user", "Speed up by 100% on level_2!"],
        ]);
        assert.deepStrictEqual(yield* search(harness, "2!"), [
          [threadId, "user", "Speed up by 100% on level_2!"],
        ]);
      }).pipe(Effect.scoped),
    );

    it.effect("a long message is cut to a snippet around the match, on one line", () =>
      Effect.gen(function* () {
        const { harness } = yield* makeHarness();
        yield* runFileCreateScenario(harness);
        const before = "Lorem ipsum dolor sit amet.\n\n".repeat(10);
        const after = " Consectetur adipiscing elit.".repeat(20);
        const threadId = yield* sendUserMessages(harness, "long", [
          `${before}The DRAGON breathes fire.${after}`,
        ]);
        const [match] = yield* search(harness, "dragon");
        assert.deepStrictEqual(match, [
          threadId,
          "user",
          "…r sit amet. Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet. The DRAGON breathes fire. Consectetur adipiscing elit. Consectetur adipiscing elit. Consectetur adipiscing elit. Consectetur adipiscing elit. Consectetur adipiscing eli…",
        ]);
      }).pipe(Effect.scoped),
    );
  });
});

/**
 * A thread in the file-create project with the person's messages, oldest
 * first. Nothing drains the effect worker afterwards, so they are never answered.
 */
const sendUserMessages = (harness: Harness, name: string, texts: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const threadId = ThreadId.make(`thread:${name}`);
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      runtimeMode: "full-access",
      commandId: CommandId.make(`command:${name}:thread`),
      threadId,
      projectId: FILE_CREATE_IDS.projectId,
      title: name,
      modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
    });
    for (const [index, text] of texts.entries()) {
      yield* harness.orchestrator.dispatch({
        type: "message.dispatch",
        dispatchMode: { type: "start_immediately" },
        commandId: CommandId.make(`command:${name}:message:${index}`),
        threadId,
        messageId: MessageId.make(`message:${name}:${index}`),
        text,
      });
      yield* TestClock.adjust("1 second");
    }
    return threadId;
  });

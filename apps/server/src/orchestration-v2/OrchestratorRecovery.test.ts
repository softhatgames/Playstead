import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId } from "@playstead/contracts/baseSchemas";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
} from "@playstead/provider-testing/replayTranscript";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { makeTestServerConfig } from "../testUtils/testServer.ts";
import type { ClaudeAgentSdkQueryRunner } from "./Adapters/ClaudeAdapterV2.ts";
import { makeClaudeReplay } from "./Adapters/ClaudeAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import {
  FILE_CREATE_IDS,
  FILE_CREATE_SCENARIO,
  sendFileCreateMessage,
} from "./testkit/fixtures/fileCreate.ts";
import {
  RESTART_RESUME_IDS,
  RESTART_RESUME_SCENARIO,
  runFirstTurn,
  runSecondTurn,
} from "./testkit/fixtures/restartResume.ts";

/**
 * Seam 1 across a restart (T3 Code's `OrchestratorReplayRecovery.integration.test.ts`
 * at 2577baf): the real services are built over a Playstead home, stop, and
 * are built again over the same SQLite file with startup recovery.
 */

const readRecording = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const recordingPath = path.join(
      path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
      "testkit",
      "fixtures",
      name,
    );
    return yield* decodeProviderReplayNdjson(yield* fs.readFileString(recordingPath));
  });

/** A provider that must not be reached: the restarted server only takes the message. */
const unreachableClaude: ClaudeAgentSdkQueryRunner["Service"] = {
  allocateSessionId: Effect.die("Claude was not expected to start."),
  open: () => Effect.die("Claude was not expected to start."),
};

/** Claude's whole final reply, the message the replay holds back below. */
const FINAL_REPLY =
  'Created `hello-claude.txt` in the working directory with the line "Hello from Claude in Playstead!"';

const isFinalReply = (frame: unknown) =>
  JSON.stringify(frame).includes(`"type":"text","text":${JSON.stringify(FINAL_REPLY)}`);

describe("Survive a restart", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "a run in flight when the server stopped is cancelled when it starts again, and the thread takes a new message",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const config = yield* makeTestServerConfig();
          const recorded = yield* readRecording("file_create.claude.ndjson");
          // Claude has streamed its reply but not finished it when the
          // server stops. The first server is left as a killed process
          // leaves it: nothing it holds is closed or written again.
          const replay = yield* makeClaudeReplay(
            yield* materializeReplayWorkspace(recorded, path.join(config.baseDir, "empty-game")),
            { holdBefore: isFinalReply },
          );
          const first = yield* makeOrchestrationHarness({ claudeRunner: replay.runner, config });
          const { sent } = yield* sendFileCreateMessage(first);
          yield* first.worker.drain;
          yield* replay.awaitHeld;
          yield* first.eventStore.streamApplicationEvents({ afterSequence: sent.sequence }).pipe(
            Stream.filter(
              (stored) =>
                stored.aggregateKind === "thread" &&
                stored.event.type === "message.updated" &&
                stored.event.payload.role === "assistant" &&
                stored.event.payload.text === FINAL_REPLY,
            ),
            Stream.runHead,
          );

          const restarted = yield* makeOrchestrationHarness({
            claudeRunner: unreachableClaude,
            config,
            recoverOnStartup: true,
          });

          const projects = yield* restarted.projects.listShells;
          assert.deepStrictEqual(
            projects.map((project) => project.id),
            [FILE_CREATE_IDS.projectId],
          );
          const projection = Option.getOrThrow(
            yield* restarted.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
          );
          assert.strictEqual(projection.thread.title, FILE_CREATE_SCENARIO.titleSeed);
          assert.deepStrictEqual(
            projection.messages.map((message) => ({
              role: message.role,
              text: message.text,
              streaming: message.streaming,
            })),
            [
              { role: "user", text: FILE_CREATE_SCENARIO.prompt, streaming: false },
              { role: "assistant", text: FINAL_REPLY, streaming: false },
            ],
          );
          assert.deepStrictEqual(
            projection.runs.map((run) => run.status),
            ["cancelled"],
          );
          assert.isNotNull(projection.runs[0]?.completedAt);
          assert.deepStrictEqual(
            projection.attempts.map((attempt) => attempt.status),
            ["cancelled"],
          );
          assert.deepStrictEqual(
            projection.nodes.filter((node) => node.kind === "root_turn").map((node) => node.status),
            ["cancelled"],
          );
          assert.deepStrictEqual(
            projection.providerTurns.map((turn) => turn.status),
            ["cancelled"],
          );
          assert.deepStrictEqual(
            projection.providerThreads.map((thread) => thread.status),
            ["idle"],
          );
          assert.deepStrictEqual(
            projection.providerSessions.map((session) => session.status),
            ["stopped"],
          );
          assert.deepStrictEqual(
            projection.turnItems.map((item) => `${item.type}:${item.status}`),
            ["user_message:completed", "file_change:completed", "assistant_message:cancelled"],
          );

          const next = yield* restarted.orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("command:file-create:after-restart"),
            threadId: FILE_CREATE_IDS.threadId,
            messageId: MessageId.make("message:file-create:after-restart"),
            text: "Are you still there?",
          });
          assert.isAbove(next.sequence, sent.sequence);
          const after = Option.getOrThrow(
            yield* restarted.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
          );
          assert.deepStrictEqual(
            after.runs.map((run) => run.status),
            ["cancelled", "starting"],
          );
        }).pipe(Effect.scoped),
    );

    it.effect("a run settled at shutdown stays cancelled when Claude's session closes after", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const config = yield* makeTestServerConfig();
        const recorded = yield* readRecording("file_create.claude.ndjson");
        const replay = yield* makeClaudeReplay(
          yield* materializeReplayWorkspace(recorded, path.join(config.baseDir, "empty-game")),
          { holdBefore: isFinalReply },
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const stopping = yield* makeOrchestrationHarness({
              claudeRunner: replay.runner,
              config,
            });
            yield* sendFileCreateMessage(stopping);
            yield* stopping.worker.drain;
            yield* replay.awaitHeld;
            // The server's shutdown settles the run before the provider
            // sessions close; closing them ends Claude's turn as failed.
            yield* stopping.recovery.reconcile("shutdown");
          }),
        );

        const restarted = yield* makeOrchestrationHarness({
          claudeRunner: unreachableClaude,
          config,
        });
        const projection = Option.getOrThrow(
          yield* restarted.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
        );
        assert.deepStrictEqual(
          projection.runs.map((run) => run.status),
          ["cancelled"],
        );
        assert.deepStrictEqual(
          projection.turnItems.filter((item) => item.type === "error"),
          [],
        );
      }).pipe(Effect.scoped),
    );

    it.effect("after a restart Claude resumes the thread's conversation and remembers it", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const config = yield* makeTestServerConfig();
        const recorded = yield* readRecording("restart_resume.claude.ndjson");
        const replay = yield* makeClaudeReplay(
          yield* materializeReplayWorkspace(recorded, path.join(config.baseDir, "resumed-game")),
        );
        const first = yield* Effect.scoped(
          Effect.flatMap(makeOrchestrationHarness({ claudeRunner: replay.runner, config }), (h) =>
            runFirstTurn(h),
          ),
        );
        assert.strictEqual(first.run.status, "completed");

        const restarted = yield* makeOrchestrationHarness({
          claudeRunner: replay.runner,
          config,
          recoverOnStartup: true,
        });
        const second = yield* runSecondTurn(restarted);

        // The replay holds the query the restarted server opened: it resumes
        // Claude's session instead of starting a new one.
        yield* replay.assertComplete;
        assert.strictEqual(second.status, "completed");
        const projection = Option.getOrThrow(
          yield* restarted.orchestrator.getThreadProjection(RESTART_RESUME_IDS.threadId),
        );
        const replies = projection.messages.filter((message) => message.role === "assistant");
        assert.match(replies.at(-1)?.text ?? "", new RegExp(RESTART_RESUME_SCENARIO.codeWord, "i"));
        assert.deepStrictEqual(
          projection.providerThreads.map((thread) => thread.nativeThreadRef?.nativeId),
          [recorded.header.metadata?.["nativeSessionId"]],
        );
      }).pipe(Effect.scoped),
    );

    it.effect(
      "a thread whose provider session hung while starting is settled, and its next turn starts",
      () =>
        Effect.gen(function* () {
          const config = yield* makeTestServerConfig();
          const opening = yield* Deferred.make<void>();
          const first = yield* makeOrchestrationHarness({
            claudeRunner: {
              allocateSessionId: Effect.succeed("hung-session"),
              open: () => Effect.andThen(Deferred.succeed(opening, undefined), Effect.never),
            },
            config,
          });
          yield* sendFileCreateMessage(first);
          // The effect worker claims the turn and never gets past opening
          // Claude's session; the server stops while it waits.
          yield* Effect.forkScoped(first.worker.drain);
          yield* Deferred.await(opening);

          const startedAgain = yield* Deferred.make<void>();
          const restarted = yield* makeOrchestrationHarness({
            claudeRunner: {
              allocateSessionId: Effect.succeed("new-session"),
              open: () => Effect.andThen(Deferred.succeed(startedAgain, undefined), Effect.never),
            },
            config,
            recoverOnStartup: true,
          });
          const settled = Option.getOrThrow(
            yield* restarted.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
          );
          assert.deepStrictEqual(
            settled.runs.map((run) => run.status),
            ["cancelled"],
          );

          yield* restarted.orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("command:file-create:after-hang"),
            threadId: FILE_CREATE_IDS.threadId,
            messageId: MessageId.make("message:file-create:after-hang"),
            text: "Try again, please.",
          });
          // The hung server's effect no longer holds the thread's queue.
          yield* Effect.forkScoped(restarted.worker.drain);
          yield* Deferred.await(startedAgain);
        }).pipe(Effect.scoped),
    );

    it.effect("a message whose turn never started is cancelled, and its turn is not started", () =>
      Effect.gen(function* () {
        const config = yield* makeTestServerConfig();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const first = yield* makeOrchestrationHarness({
              claudeRunner: unreachableClaude,
              config,
            });
            yield* sendFileCreateMessage(first);
          }),
        );

        const restarted = yield* makeOrchestrationHarness({
          claudeRunner: unreachableClaude,
          config,
          recoverOnStartup: true,
        });

        assert.strictEqual(yield* restarted.worker.drain, 0);
        const projection = Option.getOrThrow(
          yield* restarted.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
        );
        assert.deepStrictEqual(
          projection.runs.map((run) => run.status),
          ["cancelled"],
        );
        assert.deepStrictEqual(
          projection.messages.map((message) => message.text),
          [FILE_CREATE_SCENARIO.prompt],
        );
      }).pipe(Effect.scoped),
    );
  });
});

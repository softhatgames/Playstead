import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId, RunId, type ThreadId } from "@playstead/contracts/baseSchemas";
import {
  OrchestrationDispatchCommandError,
  type OrchestrationV2Command,
} from "@playstead/contracts/orchestrationV2";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
} from "@playstead/provider-testing/replayTranscript";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { makeTestServerConfig } from "../testUtils/testServer.ts";
import type { ClaudeAgentSdkQueryRunner } from "./Adapters/ClaudeAdapterV2.ts";
import { makeClaudeReplay } from "./Adapters/ClaudeAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import { FILE_CREATE_IDS, sendFileCreateMessage } from "./testkit/fixtures/fileCreate.ts";
import {
  awaitPendingQuestion,
  CLAUDE_QUESTION_SCENARIO,
  QUESTION_IDS,
  sendQuestionMessage,
} from "./testkit/fixtures/questionAnswer.ts";
import {
  RESTART_RESUME_IDS,
  RESTART_RESUME_SCENARIO,
  runFirstTurn,
  runSecondTurn,
} from "./testkit/fixtures/restartResume.ts";

/**
 * Seam 1 for archiving and deleting a thread (T3 Code's `runtimeLayer.test.ts`
 * lifecycle cases and `ThreadDeletion.test.ts` at 2577baf): the real
 * orchestrator, effect worker and projections, with Claude's transport
 * replaying recordings.
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

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

const projectionOf = (harness: Harness, threadId: ThreadId) =>
  Effect.map(harness.orchestrator.getThreadProjection(threadId), Option.getOrThrow);

const command = (harness: Harness, sent: OrchestrationV2Command) =>
  harness.orchestrator.dispatch(sent);

const archive = (harness: Harness, threadId: ThreadId, id: string) =>
  command(harness, { type: "thread.archive", commandId: CommandId.make(id), threadId });

const unarchive = (harness: Harness, threadId: ThreadId, id: string) =>
  command(harness, { type: "thread.unarchive", commandId: CommandId.make(id), threadId });

const remove = (harness: Harness, threadId: ThreadId, id: string) =>
  command(harness, { type: "thread.delete", commandId: CommandId.make(id), threadId });

const refusal = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.flip(effect), (error) => {
    assert.instanceOf(error, OrchestrationDispatchCommandError);
    return (error as OrchestrationDispatchCommandError).message;
  });

/** Claude's whole final reply in the file-create recording, held back below. */
const FINAL_REPLY =
  'Created `hello-claude.txt` in the current folder with the line "Hello from Claude in Playstead!" using the Write tool.';

const isFinalReply = (frame: unknown) =>
  JSON.stringify(frame).includes(`"type":"text","text":${JSON.stringify(FINAL_REPLY)}`);

describe("Archive and delete a thread", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "archiving stops the thread's provider session, and after unarchiving its next message resumes the conversation in a new one",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const config = yield* makeTestServerConfig();
          const recorded = yield* readRecording("restart_resume.claude.ndjson");
          const replay = yield* makeClaudeReplay(
            yield* materializeReplayWorkspace(recorded, path.join(config.baseDir, "resumed-game")),
          );
          const harness = yield* makeOrchestrationHarness({ claudeRunner: replay.runner, config });
          const threadId = RESTART_RESUME_IDS.threadId;
          const first = yield* runFirstTurn(harness);
          assert.strictEqual(first.run.status, "completed");

          yield* archive(harness, threadId, "command:archive");
          const archived = yield* projectionOf(harness, threadId);
          assert.isNotNull(archived.thread.archivedAt);
          assert.deepStrictEqual(
            archived.providerSessions.map((session) => session.status),
            ["stopped"],
          );
          // The same command sent again gets its first outcome; another archive is refused.
          yield* archive(harness, threadId, "command:archive");
          assert.strictEqual(
            yield* refusal(archive(harness, threadId, "command:archive-again")),
            `Thread ${threadId} is already archived.`,
          );
          yield* harness.worker.drain;

          yield* unarchive(harness, threadId, "command:unarchive");
          assert.isNull((yield* projectionOf(harness, threadId)).thread.archivedAt);
          assert.strictEqual(
            yield* refusal(unarchive(harness, threadId, "command:unarchive-again")),
            `Thread ${threadId} is not archived.`,
          );

          // The recording opens a second query that resumes Claude's session:
          // the archived thread's session was stopped, not reused.
          const second = yield* runSecondTurn(harness);
          yield* replay.assertComplete;
          assert.strictEqual(second.status, "completed");
          const replies = (yield* projectionOf(harness, threadId)).messages.filter(
            (message) => message.role === "assistant",
          );
          assert.match(
            replies.at(-1)?.text ?? "",
            new RegExp(RESTART_RESUME_SCENARIO.codeWord, "i"),
          );
        }).pipe(Effect.scoped),
    );

    it.effect(
      "deleting a thread while Claude is working cancels the run and stops its session, and nothing revives the run",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const config = yield* makeTestServerConfig();
          const recorded = yield* readRecording("file_create.claude.ndjson");
          const replay = yield* makeClaudeReplay(
            yield* materializeReplayWorkspace(recorded, path.join(config.baseDir, "empty-game")),
            { holdBefore: isFinalReply },
          );
          const harness = yield* makeOrchestrationHarness({ claudeRunner: replay.runner, config });
          const threadId = FILE_CREATE_IDS.threadId;
          yield* sendFileCreateMessage(harness);
          yield* harness.worker.drain;
          yield* replay.awaitHeld;

          yield* remove(harness, threadId, "command:delete");
          const deleted = yield* projectionOf(harness, threadId);
          assert.isNotNull(deleted.thread.deletedAt);
          assert.deepStrictEqual(
            deleted.runs.map((run) => run.status),
            ["cancelled"],
          );
          assert.deepStrictEqual(
            deleted.attempts.map((attempt) => attempt.status),
            ["cancelled"],
          );
          assert.deepStrictEqual(
            deleted.nodes.filter((node) => node.kind === "root_turn").map((node) => node.status),
            ["cancelled"],
          );
          assert.deepStrictEqual(
            deleted.providerSessions.map((session) => session.status),
            ["stopped"],
          );

          // Stopping the session ends Claude's turn; the cancelled run stays cancelled.
          yield* harness.worker.drain;
          const after = yield* projectionOf(harness, threadId);
          assert.deepStrictEqual(
            after.runs.map((run) => run.status),
            ["cancelled"],
          );
          assert.deepStrictEqual(
            after.turnItems.filter((item) => item.type === "error"),
            [],
          );
          assert.strictEqual(after.thread.deletedAt, deleted.thread.deletedAt);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "deleting a thread waiting on a question cancels the question, which can no longer be answered",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const config = yield* makeTestServerConfig();
          const recorded = yield* readRecording("question_answer.claude.ndjson");
          const replay = yield* makeClaudeReplay(
            yield* materializeReplayWorkspace(recorded, path.join(config.baseDir, "empty-game")),
          );
          const harness = yield* makeOrchestrationHarness({ claudeRunner: replay.runner, config });
          const { sent } = yield* sendQuestionMessage(harness, CLAUDE_QUESTION_SCENARIO);
          const pending = yield* awaitPendingQuestion(harness, sent.sequence);

          yield* remove(harness, QUESTION_IDS.threadId, "command:delete");
          const deleted = yield* projectionOf(harness, QUESTION_IDS.threadId);
          const request = deleted.runtimeRequests.find(
            (candidate) => candidate.id === pending.request.id,
          );
          assert.strictEqual(request?.status, "cancelled");
          assert.deepStrictEqual(request?.responseCapability, {
            type: "not_resumable",
            reason: "The thread was deleted.",
          });
          assert.isNotNull(request?.resolvedAt);
          assert.deepStrictEqual(
            deleted.runs.map((run) => run.status),
            ["cancelled"],
          );
          yield* harness.worker.drain;
        }).pipe(Effect.scoped),
    );

    it.effect("a deleted thread refuses every command", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const config = yield* makeTestServerConfig();
        const recorded = yield* readRecording("file_create.claude.ndjson");
        const replay = yield* makeClaudeReplay(
          yield* materializeReplayWorkspace(recorded, path.join(config.baseDir, "empty-game")),
        );
        const harness = yield* makeOrchestrationHarness({ claudeRunner: replay.runner, config });
        const threadId = FILE_CREATE_IDS.threadId;
        const { sent } = yield* sendFileCreateMessage(harness);
        yield* harness.worker.drain;
        const run = yield* harness.awaitRunEnded(threadId, sent.sequence);
        yield* archive(harness, threadId, "command:archive");
        yield* remove(harness, threadId, "command:delete");

        const refused = (sentCommand: OrchestrationV2Command) =>
          refusal(command(harness, sentCommand));
        const deleted = `Thread ${threadId} is deleted.`;
        const base = { threadId } as const;
        for (const sentCommand of [
          {
            ...base,
            type: "message.dispatch",
            commandId: CommandId.make("command:after:message"),
            messageId: MessageId.make("message:after"),
            text: "Are you there?",
          },
          {
            ...base,
            type: "thread.model-selection.set",
            commandId: CommandId.make("command:after:model"),
            modelSelection: { instanceId: "claudeAgent", model: "claude-sonnet-5-5" },
          },
          {
            ...base,
            type: "run.interrupt",
            commandId: CommandId.make("command:after:interrupt"),
            runId: RunId.make(run.id),
          },
          { ...base, type: "thread.archive", commandId: CommandId.make("command:after:archive") },
          {
            ...base,
            type: "thread.unarchive",
            commandId: CommandId.make("command:after:unarchive"),
          },
          { ...base, type: "thread.delete", commandId: CommandId.make("command:after:delete") },
        ] satisfies ReadonlyArray<OrchestrationV2Command>) {
          assert.strictEqual(yield* refused(sentCommand), deleted, sentCommand.type);
        }
        // The delete sent again gets its first outcome.
        yield* remove(harness, threadId, "command:delete");
      }).pipe(Effect.scoped),
    );

    it.effect(
      "a session stop the server was still running when it stopped runs again after a restart, and the thread's next message starts",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const config = yield* makeTestServerConfig();
          const recorded = yield* readRecording("restart_resume.claude.ndjson");
          const replay = yield* makeClaudeReplay(
            yield* materializeReplayWorkspace(recorded, path.join(config.baseDir, "resumed-game")),
          );
          // The first server's Claude session closes its query but never
          // finishes closing, so its stop is still running when that server
          // is left as a killed one.
          const closing = yield* Deferred.make<void>();
          const released = yield* Deferred.make<void>();
          const hangingClose: ClaudeAgentSdkQueryRunner["Service"] = {
            allocateSessionId: replay.runner.allocateSessionId,
            open: (input) =>
              Effect.andThen(
                Effect.addFinalizer(() =>
                  Effect.andThen(Deferred.succeed(closing, undefined), Deferred.await(released)),
                ),
                replay.runner.open(input),
              ),
          };
          const first = yield* makeOrchestrationHarness({ claudeRunner: hangingClose, config });
          const threadId = RESTART_RESUME_IDS.threadId;
          yield* runFirstTurn(first);
          yield* archive(first, threadId, "command:archive");
          yield* Effect.forkScoped(first.worker.drain);
          yield* Deferred.await(closing);

          const restarted = yield* makeOrchestrationHarness({
            claudeRunner: replay.runner,
            config,
            recoverOnStartup: true,
          });
          yield* unarchive(restarted, threadId, "command:unarchive");
          const second = yield* runSecondTurn(restarted);

          yield* replay.assertComplete;
          assert.strictEqual(second.status, "completed");
          yield* Deferred.succeed(released, undefined);
        }).pipe(Effect.scoped),
    );
  });
});

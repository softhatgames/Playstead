import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId, type ThreadId } from "@playstead/contracts/baseSchemas";
import {
  OrchestrationDispatchCommandError,
  type OrchestrationV2Command,
} from "@playstead/contracts/orchestrationV2";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
} from "@playstead/provider-testing/replayTranscript";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import { makeTestServerConfig } from "../testUtils/testServer.ts";
import { makeClaudeReplay } from "./Adapters/ClaudeAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import { FILE_CREATE_IDS, runFileCreateScenario } from "./testkit/fixtures/fileCreate.ts";
import {
  awaitPendingQuestion,
  CLAUDE_QUESTION_SCENARIO,
  QUESTION_IDS,
  sendQuestionMessage,
} from "./testkit/fixtures/questionAnswer.ts";
import { isSnoozed, snoozeStateOf } from "./ThreadSettlementService.ts";

/**
 * Seam 1 for snoozing a thread (T3 Code's `Orchestrator.ts`
 * `dispatchThreadMutation` cases for `thread.snooze` and `thread.unsnooze`,
 * `thread.pin`'s wake, `dispatchMessage`'s wake, and
 * `ThreadSettlementService.ts` `isSnoozed` at 2577baf): the real
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

const makeHarness = (recording: string, folder: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const config = yield* makeTestServerConfig();
    const recorded = yield* readRecording(recording);
    const replay = yield* makeClaudeReplay(
      yield* materializeReplayWorkspace(recorded, path.join(config.baseDir, folder)),
    );
    return yield* makeOrchestrationHarness({ claudeRunner: replay.runner, config });
  });

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

const threadOf = (harness: Harness, threadId: ThreadId) =>
  Effect.map(
    harness.orchestrator.getThreadProjection(threadId),
    (projection) => Option.getOrThrow(projection).thread,
  );

const shellOf = (harness: Harness, threadId: ThreadId) =>
  Effect.map(harness.projections.getThreadShell(threadId), Option.getOrThrow);

/** Whether the server counts the thread as snoozed at `now` (automatic settlement's `isSnoozed`). */
const snoozedAt = (harness: Harness, threadId: ThreadId, now: string) =>
  Effect.gen(function* () {
    const shell = yield* shellOf(harness, threadId);
    const thread = yield* threadOf(harness, threadId);
    return isSnoozed(
      { ...shell, hasPendingRuntimeRequest: shell.hasPendingUserInput },
      snoozeStateOf(thread),
      Date.parse(now),
    );
  });

/** The time `offset` from the test clock's now, as the interface would send it. */
const fromNow = (offset: number) =>
  Effect.map(Clock.currentTimeMillis, (now) =>
    DateTime.formatIso(DateTime.makeUnsafe(now + offset)),
  );

const HOUR = 60 * 60 * 1000;

const snooze = (harness: Harness, threadId: ThreadId, id: string, snoozedUntil: string) =>
  harness.orchestrator.dispatch({
    type: "thread.snooze",
    commandId: CommandId.make(id),
    threadId,
    snoozedUntil,
  });

const send = (
  harness: Harness,
  threadId: ThreadId,
  type: "thread.unsnooze" | "thread.pin" | "thread.archive" | "thread.delete",
  id: string,
) =>
  harness.orchestrator.dispatch(
    (type === "thread.unsnooze"
      ? { type, commandId: CommandId.make(id), threadId, reason: "user" }
      : { type, commandId: CommandId.make(id), threadId }) as OrchestrationV2Command,
  );

const refusal = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.flip(effect), (error) => {
    assert.instanceOf(error, OrchestrationDispatchCommandError);
    return (error as OrchestrationDispatchCommandError).message;
  });

describe("Snooze a thread", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "a snooze needs a future time, keeps its start when repeated, and waking clears it",
      () =>
        Effect.gen(function* () {
          const harness = yield* makeHarness("file_create.claude.ndjson", "empty-game");
          const threadId = FILE_CREATE_IDS.threadId;
          yield* runFileCreateScenario(harness);

          const past = yield* fromNow(-1000);
          assert.strictEqual(
            yield* refusal(snooze(harness, threadId, "command:snooze-past", past)),
            `Thread ${threadId} snooze wake time ${past} is not in the future.`,
          );

          yield* TestClock.adjust("1 minute");
          const wakeAt = yield* fromNow(3 * HOUR);
          yield* snooze(harness, threadId, "command:snooze", wakeAt);
          const snoozed = yield* threadOf(harness, threadId);
          assert.strictEqual(snoozed.snoozedUntil, wakeAt);
          assert.strictEqual(snoozed.snoozedAt, snoozed.updatedAt);
          assert.isNull(snoozed.lastSnoozeWakeAt);
          assert.isTrue(yield* snoozedAt(harness, threadId, yield* fromNow(0)));

          yield* TestClock.adjust("1 minute");
          yield* snooze(harness, threadId, "command:snooze-same", wakeAt);
          const again = yield* threadOf(harness, threadId);
          assert.strictEqual(again.snoozedAt, snoozed.snoozedAt);
          assert.strictEqual(again.updatedAt, snoozed.updatedAt);

          yield* send(harness, threadId, "thread.unsnooze", "command:wake");
          const woken = yield* threadOf(harness, threadId);
          assert.isNull(woken.snoozedUntil);
          assert.isNull(woken.snoozedAt);
          assert.strictEqual(woken.lastSnoozeWakeAt, woken.updatedAt);
          assert.isFalse(yield* snoozedAt(harness, threadId, yield* fromNow(0)));

          // Waking an awake thread changes nothing.
          yield* TestClock.adjust("1 minute");
          yield* send(harness, threadId, "thread.unsnooze", "command:wake-again");
          assert.deepStrictEqual(yield* threadOf(harness, threadId), woken);

          // A pin wakes a snoozed thread too.
          yield* snooze(harness, threadId, "command:snooze-then-pin", yield* fromNow(HOUR));
          yield* TestClock.adjust("1 minute");
          yield* send(harness, threadId, "thread.pin", "command:pin");
          const pinned = yield* threadOf(harness, threadId);
          assert.isNotNull(pinned.pinnedAt);
          assert.isNull(pinned.snoozedUntil);
          assert.isNull(pinned.snoozedAt);
          assert.strictEqual(pinned.lastSnoozeWakeAt, pinned.updatedAt);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "a snoozed thread wakes early when a run completes after the snooze, and a message wakes it",
      () =>
        Effect.gen(function* () {
          const harness = yield* makeHarness("file_create.claude.ndjson", "empty-game");
          const threadId = FILE_CREATE_IDS.threadId;
          let wakeAt = "";
          // Snoozed while the run is starting; the run completes a minute later.
          const { run } = yield* runFileCreateScenario(
            harness,
            Effect.gen(function* () {
              yield* TestClock.adjust("1 minute");
              wakeAt = yield* fromNow(3 * HOUR);
              yield* snooze(harness, threadId, "command:snooze", wakeAt);
              assert.isTrue(yield* snoozedAt(harness, threadId, yield* fromNow(0)));
              yield* TestClock.adjust("1 minute");
            }),
          );
          assert.strictEqual(run.status, "completed");

          // No timer and no event: the snooze is still there, but the
          // completed run wakes the thread.
          const shell = yield* shellOf(harness, threadId);
          assert.strictEqual(shell.snoozedUntil, wakeAt);
          assert.isAbove(Date.parse(shell.latestRunCompletedAt!), Date.parse(shell.snoozedAt!));
          assert.isFalse(yield* snoozedAt(harness, threadId, yield* fromNow(0)));

          // Snoozed again after the run, it stays snoozed until its time.
          yield* TestClock.adjust("1 minute");
          const later = yield* fromNow(HOUR);
          yield* snooze(harness, threadId, "command:snooze-again", later);
          assert.isTrue(yield* snoozedAt(harness, threadId, yield* fromNow(0)));
          assert.isFalse(yield* snoozedAt(harness, threadId, yield* fromNow(HOUR + 1)));

          // Sending a message wakes it.
          yield* TestClock.adjust("1 minute");
          yield* harness.orchestrator
            .dispatch({
              type: "message.dispatch",
              commandId: CommandId.make("command:message-2"),
              threadId,
              messageId: MessageId.make("message:file-create:2"),
              text: "Thanks.",
            })
            .pipe(Effect.ignore);
          const woken = yield* threadOf(harness, threadId);
          assert.isNull(woken.snoozedUntil);
          assert.isNull(woken.snoozedAt);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "snoozing is refused while the provider waits on a question, which the sidebar sees",
      () =>
        Effect.gen(function* () {
          const harness = yield* makeHarness("question_answer.claude.ndjson", "empty-game");
          const threadId = QUESTION_IDS.threadId;
          const { sent } = yield* sendQuestionMessage(harness, CLAUDE_QUESTION_SCENARIO);
          yield* awaitPendingQuestion(harness, sent.sequence);
          assert.isTrue((yield* shellOf(harness, threadId)).hasPendingUserInput);
          assert.strictEqual(
            yield* refusal(snooze(harness, threadId, "command:snooze", yield* fromNow(HOUR))),
            `Thread ${threadId} has a pending approval or user-input request and cannot be snoozed.`,
          );
          assert.isNull((yield* threadOf(harness, threadId)).snoozedUntil);
        }).pipe(Effect.scoped),
    );

    it.effect("an archived thread refuses snooze and wake, and a deleted one refuses both", () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness("file_create.claude.ndjson", "empty-game");
        const threadId = FILE_CREATE_IDS.threadId;
        yield* runFileCreateScenario(harness);
        const wakeAt = yield* fromNow(HOUR);
        for (const [step, reason] of [
          ["thread.archive", "archived"],
          ["thread.delete", "deleted"],
        ] as const) {
          yield* send(harness, threadId, step, `command:${step}`);
          assert.strictEqual(
            yield* refusal(snooze(harness, threadId, `command:${reason}:snooze`, wakeAt)),
            `Thread ${threadId} is ${reason}.`,
          );
          assert.strictEqual(
            yield* refusal(send(harness, threadId, "thread.unsnooze", `command:${reason}:wake`)),
            `Thread ${threadId} is ${reason}.`,
          );
        }
      }).pipe(Effect.scoped),
    );
  });
});

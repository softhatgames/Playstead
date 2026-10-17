import { effectiveSnoozed } from "@playstead/client-runtime/state/threadSnoozed";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, type ThreadId } from "@playstead/contracts/baseSchemas";
import {
  OrchestrationDispatchCommandError,
  type OrchestrationV2Command,
} from "@playstead/contracts/orchestrationV2";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
} from "@playstead/provider-testing/replayTranscript";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { makeTestServerConfig } from "../testUtils/testServer.ts";
import { makeClaudeReplay } from "./Adapters/ClaudeAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import {
  FILE_CREATE_IDS,
  runFileCreateScenario,
  sendFileCreateMessage,
} from "./testkit/fixtures/fileCreate.ts";
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
 * Seam 1 for pinning and settling a thread (T3 Code's `Orchestrator.ts`
 * `dispatchThreadMutation` cases for `thread.pin`, `thread.unpin`,
 * `thread.settle` and `thread.unsettle`, `dispatchMessage`'s un-settle, and
 * `runtimeLayer.test.ts`'s "settle is refused while a run is active" at
 * 2577baf): the real orchestrator, effect worker and projections, with
 * Claude's transport replaying recordings.
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

const makeHarness = (
  recording: string,
  folder: string,
  options?: Parameters<typeof makeClaudeReplay>[1],
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const config = yield* makeTestServerConfig();
    const recorded = yield* readRecording(recording);
    const replay = yield* makeClaudeReplay(
      yield* materializeReplayWorkspace(recorded, path.join(config.baseDir, folder)),
      options,
    );
    const harness = yield* makeOrchestrationHarness({ claudeRunner: replay.runner, config });
    return { harness, replay };
  });

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

const projectionOf = (harness: Harness, threadId: ThreadId) =>
  Effect.map(harness.orchestrator.getThreadProjection(threadId), Option.getOrThrow);

const threadOf = (harness: Harness, threadId: ThreadId) =>
  Effect.map(projectionOf(harness, threadId), (projection) => projection.thread);

const send = (
  harness: Harness,
  threadId: ThreadId,
  type: "thread.pin" | "thread.unpin" | "thread.settle" | "thread.unsettle",
  id: string,
  extra: { readonly orderKey?: string } = {},
) =>
  harness.orchestrator.dispatch(
    (type === "thread.unsettle"
      ? { type, commandId: CommandId.make(id), threadId, reason: "user" }
      : { type, commandId: CommandId.make(id), threadId, ...extra }) as OrchestrationV2Command,
  );

const refusal = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.flip(effect), (error) => {
    assert.instanceOf(error, OrchestrationDispatchCommandError);
    return (error as OrchestrationDispatchCommandError).message;
  });

describe("Pin and settle a thread", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "changing the inactivity setting sweeps immediately, and Never disables startup settlement",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* makeHarness("restart_resume.claude.ndjson", "resumed-game");
          const threadId = RESTART_RESUME_IDS.threadId;
          yield* runFirstTurn(harness);
          yield* TestClock.adjust("4 days");
          yield* harness.settings.updateAutoSettle(null);
          yield* harness.settlement.start;
          assert.isNull((yield* threadOf(harness, threadId)).settledOverride);
          const sequence = yield* harness.eventStore.latestApplicationSequence;
          yield* harness.settings.updateAutoSettle(3);
          yield* harness.eventStore.streamApplicationEvents({ afterSequence: sequence }).pipe(
            Stream.filter(
              (stored) =>
                stored.aggregateKind === "thread" && stored.event.type === "thread.settled",
            ),
            Stream.runHead,
          );
          assert.strictEqual((yield* threadOf(harness, threadId)).settledOverride, "settled");
        }).pipe(Effect.scoped),
    );

    for (const excluded of [
      "thread.pin",
      "thread.unsettle",
      "thread.archive",
      "thread.delete",
      "opt-out",
    ] as const) {
      it.effect(`the sweep excludes ${excluded} threads`, () =>
        Effect.gen(function* () {
          const { harness } = yield* makeHarness("restart_resume.claude.ndjson", "resumed-game");
          const threadId = RESTART_RESUME_IDS.threadId;
          yield* runFirstTurn(harness);
          if (excluded === "opt-out") {
            yield* harness.orchestrator.dispatch({
              type: "thread.auto-settle.set",
              commandId: CommandId.make("exclude"),
              threadId,
              enabled: false,
            });
          } else if (excluded === "thread.unsettle") {
            yield* harness.orchestrator.dispatch({
              type: excluded,
              commandId: CommandId.make("exclude"),
              threadId,
              reason: "user",
            });
          } else {
            yield* harness.orchestrator.dispatch({
              type: excluded,
              commandId: CommandId.make("exclude"),
              threadId,
            });
          }
          yield* TestClock.adjust("4 days");
          yield* harness.settlement.start;
          assert.notStrictEqual((yield* threadOf(harness, threadId)).settledOverride, "settled");
        }).pipe(Effect.scoped),
      );
    }

    it.effect("startup sweep leaves active runs and pending questions alone", () =>
      Effect.gen(function* () {
        const { harness } = yield* makeHarness("question_answer.claude.ndjson", "empty-game");
        const { sent } = yield* sendQuestionMessage(harness, CLAUDE_QUESTION_SCENARIO);
        yield* awaitPendingQuestion(harness, sent.sequence);
        yield* TestClock.adjust("4 days");
        yield* harness.settlement.start;
        assert.isNull((yield* threadOf(harness, QUESTION_IDS.threadId)).settledOverride);
      }).pipe(Effect.scoped),
    );

    it.effect(
      "the minute sweep settles after three inactive days, ignoring visits and title changes",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* makeHarness("restart_resume.claude.ndjson", "resumed-game");
          const threadId = RESTART_RESUME_IDS.threadId;
          yield* runFirstTurn(harness);
          yield* TestClock.adjust("3 days");
          yield* harness.settlement.start;
          assert.isNull((yield* threadOf(harness, threadId)).settledOverride);
          yield* harness.orchestrator.dispatch({
            type: "thread.metadata.update",
            commandId: CommandId.make("rename"),
            threadId,
            title: "Still old work",
          });
          yield* TestClock.adjust("1 minute");
          yield* harness.settlement.drain;
          assert.strictEqual((yield* threadOf(harness, threadId)).settledOverride, "settled");
        }).pipe(Effect.scoped),
    );

    it.effect("automatic settlement honors the per-thread opt-out and stale snapshots", () =>
      Effect.gen(function* () {
        const { harness } = yield* makeHarness("restart_resume.claude.ndjson", "resumed-game");
        const threadId = RESTART_RESUME_IDS.threadId;
        yield* runFirstTurn(harness);
        const before = yield* threadOf(harness, threadId);
        yield* TestClock.adjust("4 days");
        yield* harness.orchestrator.dispatch({
          type: "thread.auto-settle.set",
          commandId: CommandId.make("disable"),
          threadId,
          enabled: false,
        });
        assert.isNotNull((yield* threadOf(harness, threadId)).autoSettleDisabledAt);
        yield* refusal(
          harness.orchestrator.dispatch({
            type: "thread.auto-settle",
            commandId: CommandId.make("stale"),
            threadId,
            snapshotAt: before.updatedAt,
            settledAt: before.updatedAt,
          }),
        );
        assert.isNull((yield* threadOf(harness, threadId)).settledOverride);
        yield* harness.orchestrator.dispatch({
          type: "thread.auto-settle.set",
          commandId: CommandId.make("enable"),
          threadId,
          enabled: true,
        });
        const enabled = yield* threadOf(harness, threadId);
        yield* harness.orchestrator.dispatch({
          type: "thread.auto-settle",
          commandId: CommandId.make("auto"),
          threadId,
          snapshotAt: enabled.updatedAt,
          settledAt: before.updatedAt,
        });
        const settled = yield* projectionOf(harness, threadId);
        assert.strictEqual(settled.thread.settledOverride, "settled");
        assert.strictEqual(settled.thread.settledAt, before.updatedAt);
        assert.deepStrictEqual(
          settled.providerSessions.map((session) => session.status),
          ["stopped"],
        );
      }).pipe(Effect.scoped),
    );

    it.effect(
      "settling an idle thread stops its provider session, and its next message un-settles it and resumes the conversation",
      () =>
        Effect.gen(function* () {
          const { harness, replay } = yield* makeHarness(
            "restart_resume.claude.ndjson",
            "resumed-game",
          );
          const threadId = RESTART_RESUME_IDS.threadId;
          const first = yield* runFirstTurn(harness);
          assert.strictEqual(first.run.status, "completed");

          yield* TestClock.adjust("1 minute");
          yield* send(harness, threadId, "thread.settle", "command:settle");
          const settled = yield* projectionOf(harness, threadId);
          assert.strictEqual(settled.thread.settledOverride, "settled");
          assert.isNotNull(settled.thread.settledAt);
          assert.isNull(settled.thread.unsettledAt);
          assert.deepStrictEqual(
            settled.providerSessions.map((session) => session.status),
            ["stopped"],
          );
          yield* harness.worker.drain;

          yield* harness.orchestrator.dispatch({
            type: "thread.snooze",
            commandId: CommandId.make("resume:snooze"),
            threadId,
            snoozedUntil: "2099-01-01T12:00:00.000Z",
          });

          // The recording's second query resumes Claude's session: the settled
          // thread's session was stopped, and the message brought it back.
          const second = yield* runSecondTurn(harness);
          yield* replay.assertComplete;
          assert.strictEqual(second.status, "completed");
          const after = yield* projectionOf(harness, threadId);
          assert.isNull(after.thread.snoozedUntil);
          assert.isNull(after.thread.snoozedAt);
          assert.isNull(after.thread.settledOverride);
          assert.isNull(after.thread.settledAt);
          assert.isNotNull(after.thread.unsettledAt);
          assert.match(
            after.messages.findLast((message) => message.role === "assistant")?.text ?? "",
            new RegExp(RESTART_RESUME_SCENARIO.codeWord, "i"),
          );
        }).pipe(Effect.scoped),
    );

    it.effect(
      "snooze persists through the shell, preserves its timestamp on retry, and wake and pin clear it",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* makeHarness("file_create.claude.ndjson", "empty-game");
          const threadId = FILE_CREATE_IDS.threadId;
          yield* runFileCreateScenario(harness);
          const snooze = (id: string, snoozedUntil: string) =>
            harness.orchestrator.dispatch({
              type: "thread.snooze",
              commandId: CommandId.make(id),
              threadId,
              snoozedUntil,
            });
          const until = "2099-01-01T12:00:00.000Z";
          yield* snooze("snooze:1", until);
          const sleeping = yield* threadOf(harness, threadId);
          assert.strictEqual(sleeping.snoozedUntil, until);
          const shell = Option.getOrThrow(yield* Stream.runHead(harness.shell));
          assert.strictEqual(shell.kind, "snapshot");
          if (shell.kind === "snapshot") {
            assert.strictEqual(shell.snapshot.threads[0]?.snoozedUntil, until);
            assert.strictEqual(shell.snapshot.threads[0]?.snoozedAt, sleeping.snoozedAt);
          }
          assert.isNotNull(sleeping.snoozedAt);
          yield* TestClock.adjust("1 minute");
          yield* snooze("snooze:2", until);
          assert.strictEqual((yield* threadOf(harness, threadId)).snoozedAt, sleeping.snoozedAt);
          yield* harness.orchestrator.dispatch({
            type: "thread.unsnooze",
            commandId: CommandId.make("wake"),
            threadId,
            reason: "user",
          });
          const awake = yield* threadOf(harness, threadId);
          assert.isNull(awake.snoozedUntil);
          assert.isNull(awake.snoozedAt);
          assert.isNotNull(awake.lastSnoozeWakeAt);
          yield* snooze("snooze:3", until);
          yield* send(harness, threadId, "thread.pin", "pin:awake");
          assert.isNull((yield* threadOf(harness, threadId)).snoozedUntil);
          assert.match(yield* refusal(snooze("past", "1970-01-01T00:00:00.000Z")), /future/);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "a recorded completion wakes a snoozed working run without clearing the stored snooze",
      () =>
        Effect.gen(function* () {
          const { harness, replay } = yield* makeHarness("file_create.claude.ndjson", "empty-game");
          const threadId = FILE_CREATE_IDS.threadId;
          yield* runFileCreateScenario(
            harness,
            Effect.gen(function* () {
              yield* harness.orchestrator.dispatch({
                type: "thread.snooze",
                commandId: CommandId.make("working:snooze"),
                threadId,
                snoozedUntil: "2099-01-01T12:00:00.000Z",
              });
              const thread = yield* threadOf(harness, threadId);
              assert.isTrue(
                effectiveSnoozed(
                  { ...thread, latestRunCompletedAt: null, status: "starting" },
                  "1970-01-01T00:00:00.000Z",
                ),
              );
              yield* TestClock.adjust("1 minute");
            }),
          );
          yield* replay.assertComplete;
          const projection = yield* projectionOf(harness, threadId);
          assert.strictEqual(projection.thread.snoozedUntil, "2099-01-01T12:00:00.000Z");
          assert.isFalse(
            effectiveSnoozed(
              {
                ...projection.thread,
                latestRunCompletedAt: projection.runs[0]!.completedAt,
                status: projection.runs[0]!.status,
              },
              "1970-01-01T00:02:00.000Z",
            ),
          );
        }).pipe(Effect.scoped),
    );

    it.effect("settling is refused while the thread's run is working", () =>
      Effect.gen(function* () {
        const { harness, replay } = yield* makeHarness("file_create.claude.ndjson", "empty-game", {
          holdBefore: (frame) => JSON.stringify(frame).includes('"type":"result"'),
        });
        const threadId = FILE_CREATE_IDS.threadId;
        yield* sendFileCreateMessage(harness);
        yield* harness.worker.drain;
        yield* replay.awaitHeld;

        assert.strictEqual(
          yield* refusal(send(harness, threadId, "thread.settle", "command:settle")),
          `Thread ${threadId} is still running. Stop it before settling.`,
        );
        assert.isNull((yield* threadOf(harness, threadId)).settledOverride);
      }).pipe(Effect.scoped),
    );

    it.effect("settling is refused while the provider waits on a question", () =>
      Effect.gen(function* () {
        const { harness } = yield* makeHarness("question_answer.claude.ndjson", "empty-game");
        const { sent } = yield* sendQuestionMessage(harness, CLAUDE_QUESTION_SCENARIO);
        yield* awaitPendingQuestion(harness, sent.sequence);
        assert.match(
          yield* refusal(
            harness.orchestrator.dispatch({
              type: "thread.snooze",
              commandId: CommandId.make("question:snooze"),
              threadId: QUESTION_IDS.threadId,
              snoozedUntil: "2099-01-01T00:00:00.000Z",
            }),
          ),
          /pending approval or user-input request/,
        );
        assert.strictEqual(
          yield* refusal(send(harness, QUESTION_IDS.threadId, "thread.settle", "command:settle")),
          `Thread ${QUESTION_IDS.threadId} is waiting on an approval or question. Answer it before settling.`,
        );
      }).pipe(Effect.scoped),
    );

    it.effect(
      "pinning keeps the first order key and brings a settled thread back, settling drops the pin, and un-settling holds it active",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* makeHarness("file_create.claude.ndjson", "empty-game");
          const threadId = FILE_CREATE_IDS.threadId;
          yield* runFileCreateScenario(harness);

          yield* send(harness, threadId, "thread.pin", "command:pin", { orderKey: "m" });
          const pinned = yield* threadOf(harness, threadId);
          assert.isNotNull(pinned.pinnedAt);
          assert.strictEqual(pinned.pinOrderKey, "m");
          yield* TestClock.adjust("1 minute");
          yield* send(harness, threadId, "thread.pin", "command:pin-again", { orderKey: "c" });
          const pinnedAgain = yield* threadOf(harness, threadId);
          assert.strictEqual(pinnedAgain.pinnedAt, pinned.pinnedAt);
          assert.strictEqual(pinnedAgain.pinOrderKey, "m");

          yield* send(harness, threadId, "thread.settle", "command:settle");
          const settled = yield* threadOf(harness, threadId);
          assert.strictEqual(settled.settledOverride, "settled");
          assert.isNull(settled.pinnedAt);
          assert.isNull(settled.pinOrderKey);
          assert.isNull(settled.activeOrderKey);

          yield* TestClock.adjust("1 minute");
          yield* send(harness, threadId, "thread.pin", "command:pin-settled");
          const promoted = yield* threadOf(harness, threadId);
          assert.isNotNull(promoted.pinnedAt);
          assert.strictEqual(promoted.settledOverride, "active");
          assert.isNull(promoted.settledAt);

          yield* send(harness, threadId, "thread.unpin", "command:unpin");
          const unpinned = yield* threadOf(harness, threadId);
          assert.isNull(unpinned.pinnedAt);
          assert.isNull(unpinned.pinOrderKey);

          yield* send(harness, threadId, "thread.settle", "command:settle-again");
          yield* TestClock.adjust("1 minute");
          yield* send(harness, threadId, "thread.unsettle", "command:unsettle");
          const unsettled = yield* threadOf(harness, threadId);
          assert.strictEqual(unsettled.settledOverride, "active");
          assert.isNull(unsettled.settledAt);
          assert.strictEqual(unsettled.unsettledAt, unsettled.updatedAt);
        }).pipe(Effect.scoped),
    );

    it.effect("an archived thread refuses pin and settle, and a deleted one refuses them all", () =>
      Effect.gen(function* () {
        const { harness } = yield* makeHarness("file_create.claude.ndjson", "empty-game");
        const threadId = FILE_CREATE_IDS.threadId;
        yield* runFileCreateScenario(harness);
        yield* harness.orchestrator.dispatch({
          type: "thread.archive",
          commandId: CommandId.make("command:archive"),
          threadId,
        });
        for (const type of ["thread.snooze", "thread.unsnooze"] as const) {
          assert.match(
            yield* refusal(
              harness.orchestrator.dispatch({
                type,
                commandId: CommandId.make(`archive:${type}`),
                threadId,
                ...(type === "thread.snooze"
                  ? { snoozedUntil: "2099-01-01T00:00:00.000Z" }
                  : { reason: "user" as const }),
              } as OrchestrationV2Command),
            ),
            /archived/,
          );
        }
        const types = ["thread.pin", "thread.unpin", "thread.settle", "thread.unsettle"] as const;
        for (const type of types) {
          assert.strictEqual(
            yield* refusal(send(harness, threadId, type, `command:archived:${type}`)),
            `Thread ${threadId} is archived.`,
            type,
          );
        }
        yield* harness.orchestrator.dispatch({
          type: "thread.delete",
          commandId: CommandId.make("command:delete"),
          threadId,
        });
        for (const type of ["thread.snooze", "thread.unsnooze"] as const) {
          assert.match(
            yield* refusal(
              harness.orchestrator.dispatch({
                type,
                commandId: CommandId.make(`deleted:${type}`),
                threadId,
                ...(type === "thread.snooze"
                  ? { snoozedUntil: "2099-01-01T00:00:00.000Z" }
                  : { reason: "user" as const }),
              } as OrchestrationV2Command),
            ),
            /deleted/,
          );
        }
        for (const type of types) {
          assert.strictEqual(
            yield* refusal(send(harness, threadId, type, `command:deleted:${type}`)),
            `Thread ${threadId} is deleted.`,
            type,
          );
        }
      }).pipe(Effect.scoped),
    );
  });
});

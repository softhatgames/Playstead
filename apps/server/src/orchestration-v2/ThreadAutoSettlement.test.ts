import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, type ThreadId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2Command } from "@playstead/contracts/orchestrationV2";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

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
import { refusal, threadOf, projectionOf } from "./testkit/ThreadCommands.ts";
import { replayClaude } from "./testkit/ProviderReplay.ts";

/**
 * Seam 1 for automatic settlement (T3 Code's
 * `apps/server/src/orchestration-v2/ThreadSettlementService.ts` and its
 * `ThreadSettlementService.test.ts` at 2577baf): the real orchestrator,
 * projections, settings and settlement service, with Claude's transport
 * replaying a recording, on the test clock. The harness's clock starts at
 * the epoch and moves only when a test adjusts it.
 */

const DAY_MS = 24 * 60 * 60 * 1_000;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

let sent = 0;
const send = (harness: Harness, command: Record<string, unknown> & { readonly type: string }) =>
  harness.orchestrator.dispatch({
    commandId: CommandId.make(`command:${command.type}:${++sent}`),
    threadId: FILE_CREATE_IDS.threadId,
    ...command,
  } as OrchestrationV2Command);

/** Waits, without sleeping, for the thread's next `thread.settled` after `afterSequence`. */
const awaitSettled = (harness: Harness, threadId: ThreadId, afterSequence: number) =>
  harness.eventStore.streamApplicationEvents({ afterSequence }).pipe(
    Stream.filter(
      (stored) =>
        stored.aggregateKind === "thread" &&
        stored.event.threadId === threadId &&
        stored.event.type === "thread.settled",
    ),
    Stream.runHead,
  );

/** Moves the clock, lets the one-minute sweep run, and waits for its work. */
const elapse = (harness: Harness, duration: Parameters<typeof TestClock.adjust>[0]) =>
  Effect.gen(function* () {
    yield* TestClock.adjust(duration);
    yield* TestClock.adjust("1 minute");
    yield* harness.settlement.drain;
    yield* harness.worker.drain;
  });

describe("Automatic settlement", () => {
  it.layer(NodeServices.layer)((it) => {
    for (const direction of [-1, 1]) {
      it.effect(
        `dispatch protects persisted fresh messages through the grace boundary (${direction})`,
        () =>
          Effect.gen(function* () {
            const { harness } = yield* replayClaude("file_create.claude.ndjson");
            yield* runFileCreateScenario(harness);
            const projection = yield* projectionOf(harness, FILE_CREATE_IDS.threadId);
            yield* TestClock.adjust("4 days");
            const messageAt = DateTime.formatIso(yield* DateTime.now);
            const recovered = yield* makeOrchestrationHarness({
              config: harness.config,
              recoveredEvents: projection.messages
                .filter((message) => message.role === "user")
                .map((message) => ({
                  type: "message.updated" as const,
                  threadId: projection.thread.id,
                  occurredAt: messageAt,
                  payload: { ...message, createdAt: messageAt },
                })),
            });
            const thread = yield* threadOf(recovered, projection.thread.id);
            const settle = () =>
              send(recovered, {
                type: "thread.auto-settle",
                snapshotAt: thread.updatedAt,
                settledAt: thread.updatedAt,
              });
            yield* refusal(settle());
            yield* TestClock.setTime(Date.parse(messageAt) + direction * 120_000);
            yield* refusal(settle());
            assert.isNull((yield* threadOf(recovered, thread.id)).settledOverride);
            yield* TestClock.setTime(Date.parse(messageAt) + direction * 120_001);
            const sequence = yield* recovered.eventStore.latestApplicationSequence;
            yield* settle();
            assert.isTrue(Option.isSome(yield* awaitSettled(recovered, thread.id, sequence)));
            assert.strictEqual((yield* threadOf(recovered, thread.id)).settledOverride, "settled");
          }).pipe(Effect.ensuring(TestClock.setTime(0)), Effect.scoped),
      );
    }
    for (const change of ["pin", "opt-out", "snooze", "future-snapshot"] as const) {
      it.effect(`dispatch rechecks ${change} even without a clock tick`, () =>
        Effect.gen(function* () {
          const { harness } = yield* replayClaude("file_create.claude.ndjson");
          yield* runFileCreateScenario(harness);
          const thread = yield* threadOf(harness, FILE_CREATE_IDS.threadId);
          if (change === "pin") yield* send(harness, { type: "thread.pin" });
          if (change === "opt-out")
            yield* send(harness, { type: "thread.auto-settle.set", enabled: false });
          if (change === "snooze")
            yield* send(harness, {
              type: "thread.snooze",
              snoozedUntil: "1970-01-02T00:00:00.000Z",
            });
          yield* refusal(
            send(harness, {
              type: "thread.auto-settle",
              snapshotAt:
                change === "future-snapshot" ? "1970-01-02T00:00:00.000Z" : thread.updatedAt,
            }),
          );
          assert.isNull((yield* threadOf(harness, thread.id)).settledOverride);
        }).pipe(Effect.ensuring(TestClock.setTime(0)), Effect.scoped),
      );
    }
    it.effect(
      "an idle thread settles on the minute sweep once it has had no activity for the setting's days, at its last activity",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* replayClaude("file_create.claude.ndjson");
          const threadId = FILE_CREATE_IDS.threadId;
          const { run } = yield* runFileCreateScenario(harness);
          assert.strictEqual(run.status, "completed");
          yield* harness.settlement.start();

          yield* elapse(harness, 3 * DAY_MS - 2 * 60_000);
          assert.isNull((yield* threadOf(harness, threadId)).settledOverride);

          yield* elapse(harness, "2 minutes");
          const settled = yield* threadOf(harness, threadId);
          assert.strictEqual(settled.settledOverride, "settled");
          assert.strictEqual(settled.settledAt, run.completedAt);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "a snoozed thread stays until it wakes, and its inactivity counts from the wake",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* replayClaude("file_create.claude.ndjson");
          const threadId = FILE_CREATE_IDS.threadId;
          yield* runFileCreateScenario(harness);
          yield* harness.settlement.start();
          // Snoozed for five days, past the three days of inactivity.
          yield* send(harness, {
            type: "thread.snooze",
            snoozedUntil: DateTime.formatIso(DateTime.makeUnsafe(5 * DAY_MS)),
          });
          yield* elapse(harness, 4 * DAY_MS);
          assert.isNull((yield* threadOf(harness, threadId)).settledOverride);

          // Woken on day four, it waits three more days of inactivity.
          yield* send(harness, { type: "thread.unsnooze", reason: "user" });
          yield* elapse(harness, 3 * DAY_MS - 2 * 60_000);
          assert.isNull((yield* threadOf(harness, threadId)).settledOverride);
          yield* elapse(harness, "2 minutes");
          assert.strictEqual((yield* threadOf(harness, threadId)).settledOverride, "settled");
        }).pipe(Effect.scoped),
    );

    it.effect("a thread with automatic settlement turned off stays, until it is turned on", () =>
      Effect.gen(function* () {
        const { harness } = yield* replayClaude("file_create.claude.ndjson");
        const threadId = FILE_CREATE_IDS.threadId;
        yield* runFileCreateScenario(harness);
        yield* harness.orchestrator.dispatch({
          type: "thread.auto-settle.set",
          commandId: CommandId.make("command:auto-settle-off"),
          threadId,
          enabled: false,
        });
        assert.isNotNull((yield* threadOf(harness, threadId)).autoSettleDisabledAt);
        yield* harness.settlement.start();

        yield* elapse(harness, 4 * DAY_MS);
        assert.isNull((yield* threadOf(harness, threadId)).settledOverride);

        yield* harness.orchestrator.dispatch({
          type: "thread.auto-settle.set",
          commandId: CommandId.make("command:auto-settle-on"),
          threadId,
          enabled: true,
        });
        yield* elapse(harness, "1 minute");
        assert.strictEqual((yield* threadOf(harness, threadId)).settledOverride, "settled");
      }).pipe(Effect.scoped),
    );

    it.effect(
      "a pinned thread stays and settles once unpinned; a thread the person un-settled stays until a message",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* replayClaude("file_create.claude.ndjson");
          const threadId = FILE_CREATE_IDS.threadId;
          yield* runFileCreateScenario(harness);
          yield* send(harness, { type: "thread.pin" });
          yield* harness.settlement.start();

          yield* elapse(harness, 4 * DAY_MS);
          assert.isNull((yield* threadOf(harness, threadId)).settledOverride);

          yield* send(harness, { type: "thread.unpin" });
          yield* elapse(harness, "1 minute");
          assert.strictEqual((yield* threadOf(harness, threadId)).settledOverride, "settled");

          yield* send(harness, { type: "thread.unsettle", reason: "user" });
          yield* elapse(harness, 4 * DAY_MS);
          assert.strictEqual((yield* threadOf(harness, threadId)).settledOverride, "active");
        }).pipe(Effect.scoped),
    );

    it.effect("an archived thread stays, and refuses the per-thread switch", () =>
      Effect.gen(function* () {
        const { harness } = yield* replayClaude("file_create.claude.ndjson");
        const threadId = FILE_CREATE_IDS.threadId;
        yield* runFileCreateScenario(harness);
        yield* send(harness, { type: "thread.archive" });
        yield* harness.settlement.start();

        yield* elapse(harness, 4 * DAY_MS);
        const archived = yield* threadOf(harness, threadId);
        assert.isNull(archived.settledOverride);
        assert.strictEqual(
          yield* refusal(send(harness, { type: "thread.auto-settle.set", enabled: false })),
          `Thread ${threadId} is archived.`,
        );
        yield* send(harness, { type: "thread.delete" });
        assert.strictEqual(
          yield* refusal(send(harness, { type: "thread.auto-settle.set", enabled: false })),
          `Thread ${threadId} is deleted.`,
        );
      }).pipe(Effect.scoped),
    );

    it.effect("a thread whose provider waits on a question stays", () =>
      Effect.gen(function* () {
        const { harness } = yield* replayClaude("question_answer.claude.ndjson");
        const { sent: message } = yield* sendQuestionMessage(harness, CLAUDE_QUESTION_SCENARIO);
        yield* awaitPendingQuestion(harness, message.sequence);
        yield* harness.settlement.start();

        yield* elapse(harness, 4 * DAY_MS);
        assert.isNull((yield* threadOf(harness, QUESTION_IDS.threadId)).settledOverride);
      }).pipe(Effect.scoped),
    );

    it.effect("a thread whose run is still working stays", () =>
      Effect.gen(function* () {
        const { harness, replay } = yield* replayClaude("file_create.claude.ndjson", {
          claude: { holdBefore: (frame) => JSON.stringify(frame).includes('"type":"result"') },
        });
        yield* sendFileCreateMessage(harness);
        yield* harness.worker.drain;
        yield* replay.awaitHeld;
        yield* harness.settlement.start();

        yield* elapse(harness, 4 * DAY_MS);
        assert.isNull((yield* threadOf(harness, FILE_CREATE_IDS.threadId)).settledOverride);
      }).pipe(Effect.scoped),
    );

    it.effect(
      "turning the setting off keeps every thread, and turning it on sweeps at once with its days",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* replayClaude("file_create.claude.ndjson");
          const threadId = FILE_CREATE_IDS.threadId;
          const { run } = yield* runFileCreateScenario(harness);
          yield* harness.settings.updateSettings({ sidebarAutoSettleAfterDays: null });
          yield* harness.settlement.start();

          yield* elapse(harness, 2 * DAY_MS);
          assert.isNull((yield* threadOf(harness, threadId)).settledOverride);

          // No clock move: the change itself sweeps.
          const afterSequence = yield* harness.eventStore.latestApplicationSequence;
          yield* harness.settings.updateSettings({ sidebarAutoSettleAfterDays: 1 });
          assert.isTrue(Option.isSome(yield* awaitSettled(harness, threadId, afterSequence)));
          assert.strictEqual((yield* threadOf(harness, threadId)).settledAt, run.completedAt);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "the sweep's settle is refused once the thread changed after the sweep read it, or carries an override",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* replayClaude("file_create.claude.ndjson");
          const threadId = FILE_CREATE_IDS.threadId;
          const { run } = yield* runFileCreateScenario(harness);
          const read = yield* threadOf(harness, threadId);

          yield* TestClock.adjust("1 minute");
          yield* send(harness, { type: "thread.metadata.update", title: "Renamed" });
          assert.strictEqual(
            yield* refusal(
              send(harness, {
                type: "thread.auto-settle",
                snapshotAt: read.updatedAt,
                settledAt: run.completedAt,
              }),
            ),
            `Thread ${threadId} changed before automatic settlement.`,
          );

          const renamed = yield* threadOf(harness, threadId);
          yield* send(harness, {
            type: "thread.auto-settle",
            snapshotAt: renamed.updatedAt,
            settledAt: run.completedAt,
          });
          const settled = yield* threadOf(harness, threadId);
          assert.strictEqual(settled.settledOverride, "settled");
          assert.strictEqual(settled.settledAt, run.completedAt);

          assert.strictEqual(
            yield* refusal(
              send(harness, {
                type: "thread.auto-settle",
                snapshotAt: settled.updatedAt,
              }),
            ),
            `Thread ${threadId} changed before automatic settlement.`,
          );
        }).pipe(Effect.scoped),
    );
  });
});

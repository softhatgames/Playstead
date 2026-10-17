import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import {
  type MessageDispatchMode,
  type OrchestrationV2Command,
  type OrchestrationV2Run,
} from "@playstead/contracts/orchestrationV2";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type { ClaudeAgentSdkQueryRunner } from "./Adapters/ClaudeAdapterV2.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import { replayClaude } from "./testkit/ProviderReplay.ts";
import {
  CLAUDE_MESSAGE_STEERING_SCENARIO,
  MESSAGE_STEERING_IDS,
  runMessageSteeringScenario,
} from "./testkit/fixtures/messageSteering.ts";
import { FILE_CREATE_IDS, sendFileCreateMessage } from "./testkit/fixtures/fileCreate.ts";
import {
  awaitPendingApproval,
  CLAUDE_SUPERVISED_SCENARIO,
  sendSupervisedMessage,
  SUPERVISED_IDS,
} from "./testkit/fixtures/supervisedApproval.ts";
import { projectionOf, refusal } from "./testkit/ThreadCommands.ts";

/**
 * Seam 1 for slice 2's settle, snooze, archive and delete rules meeting
 * slice 1's approvals and queue (T3 Code's guards in `dispatchThreadMutation`,
 * `planThreadDeletion` and `dispatchMessage`, and its settlement candidates,
 * at 2577baf). Queued runs need no provider: the effect worker is never
 * drained, so a started run stays `starting`. Approvals come from Claude's
 * Supervised recording, held at its first approval.
 */

const PROJECT_ID = ProjectId.make("project:turn-control");
const THREAD_ID = ThreadId.make("thread:turn-control");
const DAY_MS = 24 * 60 * 60 * 1_000;

const NO_TURN: ClaudeAgentSdkQueryRunner["Service"] = {
  allocateSessionId: Effect.die("No turn starts in this test."),
  open: () => Effect.die("No turn starts in this test."),
};

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

/** A harness whose provider never runs a turn, with a project and a thread in it. */
const harnessWithThread = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const harness = yield* makeOrchestrationHarness({ claudeRunner: NO_TURN });
  const folder = path.join(harness.home, "game");
  yield* fs.makeDirectory(folder);
  yield* harness.projects.create({
    commandId: CommandId.make("command:turn-control:project"),
    projectId: PROJECT_ID,
    title: "game",
    workspaceRoot: folder,
  });
  yield* harness.orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make("command:turn-control:thread"),
    threadId: THREAD_ID,
    projectId: PROJECT_ID,
    title: "New thread",
    modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
    runtimeMode: "full-access",
  });
  return harness;
});

let commands = 0;
/** A thread command with a fresh command id. */
const dispatch = (
  harness: Harness,
  threadId: ThreadId,
  command: Record<string, unknown> & { readonly type: string },
) =>
  harness.orchestrator.dispatch({
    commandId: CommandId.make(`command:turn-control:${command.type}:${++commands}`),
    threadId,
    ...command,
  } as OrchestrationV2Command);

const send = (harness: Harness, n: number, dispatchMode: MessageDispatchMode) =>
  harness.orchestrator.dispatch({
    type: "message.dispatch",
    commandId: CommandId.make(`command:turn-control:message:${n}`),
    threadId: THREAD_ID,
    messageId: MessageId.make(`message:turn-control:${n}`),
    text: `Message ${n}`,
    dispatchMode,
  });

const runOf = (runs: ReadonlyArray<OrchestrationV2Run>, n: number) => {
  const run = runs.find((candidate) => candidate.userMessageId === `message:turn-control:${n}`);
  assert.isDefined(run);
  return run!;
};

/** Message 1 starts, message 2 waits behind it, and Stop holds the queue: nothing runs, one message waits. */
const holdOneQueuedMessage = (harness: Harness) =>
  Effect.gen(function* () {
    yield* send(harness, 1, { type: "start_immediately" });
    yield* send(harness, 2, { type: "queue_after_active" });
    yield* dispatch(harness, THREAD_ID, {
      type: "run.interrupt",
      runId: runOf((yield* projectionOf(harness, THREAD_ID)).runs, 1).id,
      holdQueue: true,
    });
    const { runs } = yield* projectionOf(harness, THREAD_ID);
    assert.deepStrictEqual(
      [runOf(runs, 1).status, runOf(runs, 2).status, runOf(runs, 2).queueHeld],
      ["interrupted", "queued", true],
    );
    return runOf(runs, 2);
  });

/** Claude's Supervised turn, held at its first approval: the run waits on the person. */
const threadWaitingOnApproval = Effect.gen(function* () {
  const { harness } = yield* replayClaude("approval_accept.claude.ndjson");
  const { sent } = yield* sendSupervisedMessage(harness, CLAUDE_SUPERVISED_SCENARIO);
  const approval = yield* awaitPendingApproval(harness, sent.sequence);
  return { harness, approval };
});

/** A wake time `days` ahead of the test clock. */
const inFuture = (days: number) =>
  Effect.map(DateTime.now, (now) =>
    DateTime.formatIso(DateTime.add(now, { milliseconds: days * DAY_MS })),
  );

/** Moves the clock past the default three days, lets the minute sweep run, and waits for its work. */
const elapseFourDays = (harness: Harness) =>
  Effect.gen(function* () {
    yield* TestClock.adjust(4 * DAY_MS);
    yield* TestClock.adjust("1 minute");
    yield* harness.settlement.drain;
    yield* harness.worker.drain;
  });

describe("Settle, snooze, archive and delete with approvals and queued messages", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("a thread waiting on an approval can be neither settled nor snoozed", () =>
      Effect.gen(function* () {
        const { harness } = yield* threadWaitingOnApproval;
        const threadId = SUPERVISED_IDS.threadId;

        assert.strictEqual(
          yield* refusal(dispatch(harness, threadId, { type: "thread.settle" })),
          `Thread ${threadId} is waiting on an approval or question. Answer it before settling.`,
        );
        assert.strictEqual(
          yield* refusal(
            dispatch(harness, threadId, {
              type: "thread.snooze",
              snoozedUntil: yield* inFuture(1),
            }),
          ),
          `Thread ${threadId} has a pending approval or user-input request and cannot be snoozed.`,
        );
        const { thread } = yield* projectionOf(harness, threadId);
        assert.deepStrictEqual([thread.settledOverride, thread.snoozedUntil], [null, null]);
      }).pipe(Effect.scoped),
    );

    it.effect(
      "a thread with a queued message can be neither settled nor snoozed, until the message leaves the queue",
      () =>
        Effect.gen(function* () {
          const harness = yield* harnessWithThread;
          const queued = yield* holdOneQueuedMessage(harness);

          assert.strictEqual(
            yield* refusal(dispatch(harness, THREAD_ID, { type: "thread.settle" })),
            `Thread ${THREAD_ID} has a queued message. Send it or remove it from the queue before settling.`,
          );
          assert.strictEqual(
            yield* refusal(
              dispatch(harness, THREAD_ID, {
                type: "thread.snooze",
                snoozedUntil: yield* inFuture(1),
              }),
            ),
            `Thread ${THREAD_ID} has a queued run and cannot be snoozed.`,
          );

          yield* dispatch(harness, THREAD_ID, { type: "queued-run.cancel", runId: queued.id });
          yield* dispatch(harness, THREAD_ID, { type: "thread.settle" });
          assert.strictEqual(
            (yield* projectionOf(harness, THREAD_ID)).thread.settledOverride,
            "settled",
          );
        }).pipe(Effect.scoped),
    );

    it.effect("a working thread can be snoozed, but not once a message waits behind its run", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;
        yield* send(harness, 1, { type: "start_immediately" });
        yield* send(harness, 2, { type: "queue_after_active" });

        assert.strictEqual(
          yield* refusal(
            dispatch(harness, THREAD_ID, {
              type: "thread.snooze",
              snoozedUntil: yield* inFuture(1),
            }),
          ),
          `Thread ${THREAD_ID} has a queued run and cannot be snoozed.`,
        );
      }).pipe(Effect.scoped),
    );

    it.effect(
      "archiving cancels the queued messages, which leave the queue, and leaves the active run alone",
      () =>
        Effect.gen(function* () {
          const harness = yield* harnessWithThread;
          yield* send(harness, 1, { type: "start_immediately" });
          yield* send(harness, 2, { type: "queue_after_active" });
          yield* send(harness, 3, { type: "queue_after_active" });

          yield* dispatch(harness, THREAD_ID, { type: "thread.archive" });
          const archived = yield* projectionOf(harness, THREAD_ID);
          assert.isNotNull(archived.thread.archivedAt);
          assert.deepStrictEqual(
            [1, 2, 3].map((n) => {
              const run = runOf(archived.runs, n);
              return [run.status, run.queuePosition ?? null];
            }),
            [
              ["starting", null],
              ["cancelled", null],
              ["cancelled", null],
            ],
          );
          for (const n of [2, 3]) {
            const run = runOf(archived.runs, n);
            assert.strictEqual(
              archived.attempts.find((attempt) => attempt.id === run.activeAttemptId)?.status,
              "cancelled",
            );
            assert.strictEqual(
              archived.nodes.find((node) => node.id === run.rootNodeId)?.status,
              "cancelled",
            );
          }
        }).pipe(Effect.scoped),
    );

    it.effect(
      "archiving a thread waiting on an approval stops its provider, so the approval can no longer be answered",
      () =>
        Effect.gen(function* () {
          // T3 Code lets a thread waiting on the person be archived (only a
          // starting or running one is blocked, in the interface) and
          // detaches its session; a session with one provider thread just
          // closes, ending the turn.
          const { harness, approval } = yield* threadWaitingOnApproval;
          const threadId = SUPERVISED_IDS.threadId;

          yield* dispatch(harness, threadId, { type: "thread.archive" });
          yield* harness.worker.drain;
          const archived = yield* projectionOf(harness, threadId);
          assert.deepStrictEqual(
            archived.runs.map((run) => run.status),
            ["failed"],
          );
          assert.strictEqual(
            archived.runtimeRequests.find((candidate) => candidate.id === approval.id)?.status,
            "cancelled",
          );
          assert.strictEqual(
            yield* refusal(
              dispatch(harness, threadId, {
                type: "runtime-request.respond",
                requestId: approval.id,
                decision: "accept",
              }),
            ),
            `Runtime request ${approval.id} is cancelled.`,
          );
        }).pipe(Effect.scoped),
    );

    it.effect(
      "the provider session of a thread archived while waiting on an approval stays stopped after its run ends",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* threadWaitingOnApproval;
          const threadId = SUPERVISED_IDS.threadId;

          yield* dispatch(harness, threadId, { type: "thread.archive" });
          yield* harness.worker.drain;
          const archived = yield* projectionOf(harness, threadId);
          assert.deepStrictEqual(
            archived.runs.map((run) => run.status),
            ["failed"],
          );
          assert.deepStrictEqual(
            archived.providerSessions.map((session) => session.status),
            ["stopped"],
          );
        }).pipe(Effect.scoped),
    );

    it.effect("the provider session of a thread archived just as its run ends stays stopped", () =>
      Effect.gen(function* () {
        // The archive commits after the run's end has decided what to write
        // and before it writes, as when both land at the same moment.
        let beforeNextWrite: ReturnType<typeof dispatch> | undefined;
        const { harness } = yield* replayClaude("file_create.claude.ndjson", {
          harness: {
            eventSink: (sink) => ({
              ...sink,
              writeIfRunStatus: (guard, events) =>
                Effect.suspend(() => {
                  const before = beforeNextWrite;
                  beforeNextWrite = undefined;
                  const write = sink.writeIfRunStatus(guard, events);
                  return before === undefined ? write : Effect.andThen(Effect.orDie(before), write);
                }),
            }),
          },
        });
        const threadId = FILE_CREATE_IDS.threadId;
        const turnEnd = yield* harness.holdNextTurnEnd;
        const { sent } = yield* sendFileCreateMessage(harness);
        yield* harness.worker.drain;
        yield* turnEnd.reached;

        beforeNextWrite = dispatch(harness, threadId, { type: "thread.archive" });
        yield* turnEnd.release;
        const run = yield* harness.awaitRunEnded(threadId, sent.sequence);
        assert.strictEqual(run.status, "completed");
        const archived = yield* projectionOf(harness, threadId);
        assert.isNotNull(archived.thread.archivedAt);
        assert.deepStrictEqual(
          archived.providerSessions.map((session) => session.status),
          ["stopped"],
        );
      }).pipe(Effect.scoped),
    );

    it.effect("deleting a thread cancels its active run and its queued messages", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;
        yield* send(harness, 1, { type: "start_immediately" });
        yield* send(harness, 2, { type: "queue_after_active" });

        yield* dispatch(harness, THREAD_ID, { type: "thread.delete" });
        const deleted = yield* projectionOf(harness, THREAD_ID);
        assert.deepStrictEqual(
          [1, 2].map((n) => {
            const run = runOf(deleted.runs, n);
            return [run.status, run.queuePosition ?? null];
          }),
          [
            ["cancelled", null],
            ["cancelled", null],
          ],
        );
      }).pipe(Effect.scoped),
    );

    it.effect(
      "deleting a thread waiting on an approval cancels the approval, which can no longer be answered",
      () =>
        Effect.gen(function* () {
          const { harness, approval } = yield* threadWaitingOnApproval;
          const threadId = SUPERVISED_IDS.threadId;

          yield* dispatch(harness, threadId, { type: "thread.delete" });
          const deleted = yield* projectionOf(harness, threadId);
          const request = deleted.runtimeRequests.find((candidate) => candidate.id === approval.id);
          assert.strictEqual(request?.status, "cancelled");
          assert.deepStrictEqual(request?.responseCapability, {
            type: "not_resumable",
            reason: "The thread was deleted.",
          });
          assert.deepStrictEqual(
            deleted.runs.map((run) => run.status),
            ["cancelled"],
          );
          assert.strictEqual(
            yield* refusal(
              dispatch(harness, threadId, {
                type: "runtime-request.respond",
                requestId: approval.id,
                decision: "accept",
              }),
            ),
            `Thread ${threadId} is deleted.`,
          );
          yield* harness.worker.drain;
        }).pipe(Effect.scoped),
    );

    it.effect(
      "a message queued behind the run brings the thread back to active work and wakes it",
      () =>
        Effect.gen(function* () {
          const harness = yield* harnessWithThread;
          yield* send(harness, 1, { type: "start_immediately" });
          yield* dispatch(harness, THREAD_ID, { type: "thread.unsettle", reason: "user" });
          yield* dispatch(harness, THREAD_ID, {
            type: "thread.snooze",
            snoozedUntil: yield* inFuture(1),
          });

          yield* send(harness, 2, { type: "queue_after_active" });
          const { thread, runs } = yield* projectionOf(harness, THREAD_ID);
          assert.deepStrictEqual(
            [thread.settledOverride, thread.snoozedUntil, runOf(runs, 2).status],
            [null, null, "queued"],
          );
        }).pipe(Effect.scoped),
    );

    it.effect("a message that steers the running turn wakes the thread", () =>
      Effect.gen(function* () {
        const { harness, assertComplete } = yield* replayClaude("message_steering.claude.ndjson", {
          workspace: "steer-game",
        });
        const threadId = MESSAGE_STEERING_IDS.threadId;
        let snoozedAt = 0;
        yield* runMessageSteeringScenario(harness, CLAUDE_MESSAGE_STEERING_SCENARIO, {
          steerBy: "message",
          lateSteer: "while_shown_running",
          beforeSteer: (current) =>
            Effect.gen(function* () {
              const snoozed = yield* dispatch(current, threadId, {
                type: "thread.snooze",
                snoozedUntil: yield* inFuture(1),
              });
              snoozedAt = snoozed.sequence;
            }),
        });
        yield* assertComplete;

        const woken = yield* harness.eventStore
          .streamApplicationEvents({ afterSequence: snoozedAt })
          .pipe(
            Stream.filter(
              (stored) =>
                stored.aggregateKind === "thread" && stored.event.type === "thread.unsnoozed",
            ),
            Stream.runHead,
          );
        assert.strictEqual(
          Option.getOrThrow(woken).commandId,
          "command:message-steering:message:2",
        );
        const { thread, turnItems } = yield* projectionOf(harness, threadId);
        assert.isNull(thread.snoozedUntil);
        assert.isTrue(
          turnItems.some(
            (item) =>
              item.type === "user_message" &&
              item.messageId === MESSAGE_STEERING_IDS.messageId(2) &&
              item.inputIntent === "steer",
          ),
        );
      }).pipe(Effect.scoped),
    );

    it.effect("a thread waiting on an approval is no candidate for automatic settlement", () =>
      Effect.gen(function* () {
        const { harness } = yield* threadWaitingOnApproval;
        yield* harness.settlement.start();

        yield* elapseFourDays(harness);
        assert.deepStrictEqual(yield* harness.projections.getSettlementCandidates(), []);
        assert.isNull(
          (yield* projectionOf(harness, SUPERVISED_IDS.threadId)).thread.settledOverride,
        );
      }).pipe(Effect.scoped),
    );

    it.effect("a thread with a queued message is no candidate for automatic settlement", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;
        yield* holdOneQueuedMessage(harness);
        yield* harness.settlement.start();

        yield* elapseFourDays(harness);
        assert.deepStrictEqual(yield* harness.projections.getSettlementCandidates(), []);
        assert.isNull((yield* projectionOf(harness, THREAD_ID)).thread.settledOverride);
      }).pipe(Effect.scoped),
    );
  });
});

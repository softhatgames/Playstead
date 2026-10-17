import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import {
  type MessageDispatchMode,
  type ModelSelection,
  OrchestrationDispatchCommandError,
  type OrchestrationV2Run,
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

import type { ServerConfig } from "../config.ts";
import { makeTestServerConfig } from "../testUtils/testServer.ts";
import {
  type ClaudeAgentSdkQueryRunner,
  ClaudeAgentSdkQueryRunnerError,
} from "./Adapters/ClaudeAdapterV2.ts";
import { makeClaudeReplay } from "./Adapters/ClaudeAdapterV2.testkit.ts";
import { makeCodexReplay } from "./Adapters/CodexAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import {
  CLAUDE_QUEUED_TURN_SCENARIO,
  CODEX_QUEUED_TURN_SCENARIO,
  QUEUED_TURN_IDS,
  type QueuedTurnScenario,
  runQueuedTurnScenario,
} from "./testkit/fixtures/queuedTurn.ts";

const PROJECT_ID = ProjectId.make("project:queue");
const THREAD_ID = ThreadId.make("thread:queue");
const HAIKU: ModelSelection = { instanceId: "claudeAgent", model: "claude-haiku-5-5" };

/**
 * Seam 1 without a provider turn: the effect worker is never drained, so
 * every run the queue starts stays `starting`, and Claude's runner is never
 * reached.
 */
const NO_TURN: ClaudeAgentSdkQueryRunner["Service"] = {
  allocateSessionId: Effect.die("No turn starts in this test."),
  open: () => Effect.die("No turn starts in this test."),
};

const makeHarness = (input?: {
  readonly claudeRunner?: ClaudeAgentSdkQueryRunner["Service"];
  readonly config?: ServerConfig["Service"];
  readonly recoverOnStartup?: boolean;
}) =>
  makeOrchestrationHarness({
    claudeRunner: input?.claudeRunner ?? NO_TURN,
    ...(input?.config === undefined ? {} : { config: input.config }),
    ...(input?.recoverOnStartup === undefined ? {} : { recoverOnStartup: input.recoverOnStartup }),
  });

const withThread = (harness: Effect.Success<ReturnType<typeof makeHarness>>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(harness.home, "game");
    yield* fs.makeDirectory(folder);
    yield* harness.projects.create({
      commandId: CommandId.make("command:queue:project"),
      projectId: PROJECT_ID,
      title: "game",
      workspaceRoot: folder,
    });
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:queue:thread"),
      threadId: THREAD_ID,
      projectId: PROJECT_ID,
      title: "New thread",
      modelSelection: HAIKU,
      runtimeMode: "full-access",
    });
    return harness;
  });

const harnessWithThread = Effect.flatMap(makeHarness(), withThread);

type Harness = Effect.Success<typeof harnessWithThread>;

const send = (
  harness: Harness,
  n: number,
  options?: {
    readonly dispatchMode?: MessageDispatchMode;
    readonly modelSelection?: ModelSelection;
  },
) =>
  harness.orchestrator.dispatch({
    type: "message.dispatch",
    commandId: CommandId.make(`command:queue:message:${n}`),
    threadId: THREAD_ID,
    messageId: MessageId.make(`message:queue:${n}`),
    text: `Message ${n}`,
    dispatchMode: options?.dispatchMode ?? { type: "queue_after_active" },
    ...(options?.modelSelection === undefined ? {} : { modelSelection: options.modelSelection }),
  });

const threadOf = (harness: Harness) =>
  Effect.map(harness.orchestrator.getThreadProjection(THREAD_ID), Option.getOrThrow);

/** The run whose message is message `n`. */
const runOf = (runs: ReadonlyArray<OrchestrationV2Run>, n: number) => {
  const run = runs.find((candidate) => candidate.userMessageId === `message:queue:${n}`);
  assert.isDefined(run);
  return run!;
};

/** Waits, without sleeping, until message `n`'s run reaches `status`. */
const awaitRunStatus = (harness: Harness, n: number, status: OrchestrationV2Run["status"]) =>
  harness.eventStore.streamApplicationEvents({ afterSequence: 0 }).pipe(
    Stream.filter(
      (stored) =>
        stored.aggregateKind === "thread" &&
        stored.event.type === "run.updated" &&
        stored.event.payload.userMessageId === `message:queue:${n}` &&
        stored.event.payload.status === status,
    ),
    Stream.runHead,
  );

const interrupt = (harness: Harness, run: OrchestrationV2Run, holdQueue?: boolean) =>
  harness.orchestrator.dispatch({
    type: "run.interrupt",
    commandId: CommandId.make(`command:queue:interrupt:${run.id}`),
    threadId: THREAD_ID,
    runId: run.id,
    ...(holdQueue === undefined ? {} : { holdQueue }),
  });

const resume = (harness: Harness, n = 1) =>
  harness.orchestrator.dispatch({
    type: "queue.resume",
    commandId: CommandId.make(`command:queue:resume:${n}`),
    threadId: THREAD_ID,
  });

/** Message 1 starting, and messages 2 to `count` queued behind it. */
const queueBehindFirst = (harness: Harness, count: number) =>
  Effect.gen(function* () {
    yield* send(harness, 1, { dispatchMode: { type: "start_immediately" } });
    for (let n = 2; n <= count; n += 1) yield* send(harness, n);
    return yield* threadOf(harness);
  });

const queuedTexts = (projection: Effect.Success<ReturnType<typeof threadOf>>) =>
  projection.runs
    .filter((run) => run.status === "queued")
    .toSorted((left, right) => (left.queuePosition ?? 0) - (right.queuePosition ?? 0))
    .map((run) => projection.messages.find((message) => message.id === run.userMessageId)?.text);

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

/** Seam 1 with Claude's `query()` replaying the queue recording. */
const claudeReplay = Effect.gen(function* () {
  const path = yield* Path.Path;
  const recorded = yield* readRecording("queued_turn.claude.ndjson");
  let replay: Effect.Success<ReturnType<typeof makeClaudeReplay>> | undefined;
  const harness = yield* makeOrchestrationHarness({
    claudeRunner: {
      allocateSessionId: Effect.suspend(() => replay!.runner.allocateSessionId),
      open: (input) => Effect.suspend(() => replay!.runner.open(input)),
    },
  });
  replay = yield* makeClaudeReplay(
    yield* materializeReplayWorkspace(recorded, path.join(harness.home, "queue-game")),
  );
  return { harness, assertComplete: replay.assertComplete };
});

/** The same with Codex's app-server replayed. */
const codexReplay = Effect.gen(function* () {
  const path = yield* Path.Path;
  const recorded = yield* readRecording("queued_turn.codex.ndjson");
  let replay: Effect.Success<ReturnType<typeof makeCodexReplay>> | undefined;
  const harness = yield* makeOrchestrationHarness({
    codexClients: { open: (input) => Effect.suspend(() => replay!.clients.open(input)) },
  });
  replay = yield* makeCodexReplay(
    yield* materializeReplayWorkspace(recorded, path.join(harness.home, "queue-game")),
  );
  return { harness, assertComplete: replay.assertComplete };
});

/**
 * Runs the queue scenario over a replay and checks what the person sees.
 * The replay itself checks each turn the adapter started, message two's
 * effort included.
 */
const queuedTurns = <E>(
  replay: {
    readonly harness: Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;
    readonly assertComplete: Effect.Effect<void, E>;
  },
  scenario: QueuedTurnScenario,
) =>
  Effect.gen(function* () {
    const { harness } = replay;

    const result = yield* runQueuedTurnScenario(harness, scenario);

    yield* replay.assertComplete;
    const projection = Option.getOrThrow(
      yield* harness.orchestrator.getThreadProjection(QUEUED_TURN_IDS.threadId),
    );
    const statusOf = (n: number) =>
      projection.runs.find((run) => run.userMessageId === QUEUED_TURN_IDS.messageId(n))?.status;
    assert.deepStrictEqual([1, 2, 3, 4, 5].map(statusOf), [
      "completed",
      "completed",
      "cancelled",
      "interrupted",
      "completed",
    ]);
    assert.deepStrictEqual(
      result.held.runs
        .filter((run) => run.status === "queued")
        .map((run) => [run.userMessageId, run.queueHeld]),
      [[QUEUED_TURN_IDS.messageId(5), true]],
    );
    assert.strictEqual(result.startedWhileHeld, 0);
    assert.deepStrictEqual(
      projection.turnItems.flatMap((item) =>
        item.type === "user_message" ? [[item.messageId, item.inputIntent]] : [],
      ),
      [
        [QUEUED_TURN_IDS.messageId(1), "turn_start"],
        [QUEUED_TURN_IDS.messageId(2), "queued_turn"],
        [QUEUED_TURN_IDS.messageId(4), "turn_start"],
        [QUEUED_TURN_IDS.messageId(5), "queued_turn"],
      ],
    );
    const replies = projection.turnItems.flatMap((item) =>
      item.type === "assistant_message" ? [item.text.toLowerCase()] : [],
    );
    assert.deepStrictEqual(
      ["one", "two", "five"].map((word) => replies.some((reply) => reply.includes(word))),
      [true, true, true],
    );
    assert.notInclude(replies.join(" "), "three");
  });

describe("The queue", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("Codex runs queued messages as turns of their own, and holds them after Stop", () =>
      Effect.flatMap(codexReplay, (replay) => queuedTurns(replay, CODEX_QUEUED_TURN_SCENARIO)),
    );

    it.effect("Claude runs queued messages as turns of their own, and holds them after Stop", () =>
      Effect.flatMap(claudeReplay, (replay) => queuedTurns(replay, CLAUDE_QUEUED_TURN_SCENARIO)),
    );

    it.effect("a message sent while a run is active waits in the queue behind it", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;
        yield* send(harness, 1, { dispatchMode: { type: "start_immediately" } });

        yield* send(harness, 2);
        yield* send(harness, 3, { dispatchMode: { type: "start_immediately" } });

        const projection = yield* threadOf(harness);
        const first = runOf(projection.runs, 1);
        const second = runOf(projection.runs, 2);
        const third = runOf(projection.runs, 3);
        assert.strictEqual(first.status, "starting");
        assert.deepStrictEqual(
          [second.status, second.queuePosition, third.status, third.queuePosition],
          ["queued", 1, "queued", 2],
        );
        // The queued messages are kept, and reach the timeline once their runs start.
        assert.deepStrictEqual(
          projection.messages.map((message) => message.text),
          ["Message 1", "Message 2", "Message 3"],
        );
        assert.deepStrictEqual(
          projection.turnItems.flatMap((item) => (item.type === "user_message" ? [item.text] : [])),
          ["Message 1"],
        );
      }),
    );

    it.effect("a queued message can be moved in front of another, or to the end", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;
        const before = yield* queueBehindFirst(harness, 4);

        yield* harness.orchestrator.dispatch({
          type: "queued-run.reorder",
          commandId: CommandId.make("command:queue:reorder:1"),
          threadId: THREAD_ID,
          runId: runOf(before.runs, 4).id,
          beforeRunId: runOf(before.runs, 2).id,
        });
        assert.deepStrictEqual(queuedTexts(yield* threadOf(harness)), [
          "Message 4",
          "Message 2",
          "Message 3",
        ]);
        yield* harness.orchestrator.dispatch({
          type: "queued-run.reorder",
          commandId: CommandId.make("command:queue:reorder:2"),
          threadId: THREAD_ID,
          runId: runOf(before.runs, 4).id,
          beforeRunId: null,
        });

        assert.deepStrictEqual(queuedTexts(yield* threadOf(harness)), [
          "Message 2",
          "Message 3",
          "Message 4",
        ]);
        const refused = yield* Effect.flip(
          harness.orchestrator.dispatch({
            type: "queued-run.reorder",
            commandId: CommandId.make("command:queue:reorder:3"),
            threadId: THREAD_ID,
            runId: runOf(before.runs, 1).id,
            beforeRunId: null,
          }),
        );
        assert.strictEqual(refused.message, `Run ${runOf(before.runs, 1).id} is not queued.`);
      }),
    );

    it.effect("a queued message can be edited, but not emptied", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;
        const before = yield* queueBehindFirst(harness, 2);
        const edit = (n: number, text: string) =>
          harness.orchestrator.dispatch({
            type: "queued-run.edit",
            commandId: CommandId.make(`command:queue:edit:${n}`),
            threadId: THREAD_ID,
            runId: runOf(before.runs, 2).id,
            text,
          });

        yield* edit(1, "Message 2, edited");
        const refused = yield* Effect.flip(edit(2, "   "));

        assert.deepStrictEqual(queuedTexts(yield* threadOf(harness)), ["Message 2, edited"]);
        assert.instanceOf(refused, OrchestrationDispatchCommandError);
        assert.strictEqual(
          refused.message,
          `Queued run ${runOf(before.runs, 2).id} cannot be edited to an empty message.`,
        );
      }),
    );

    it.effect("a queued message removed while the run is active never starts", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;
        const before = yield* queueBehindFirst(harness, 2);

        yield* harness.orchestrator.dispatch({
          type: "queued-run.cancel",
          commandId: CommandId.make("command:queue:cancel"),
          threadId: THREAD_ID,
          runId: runOf(before.runs, 2).id,
        });
        yield* interrupt(harness, runOf(before.runs, 1));

        const projection = yield* threadOf(harness);
        const removed = runOf(projection.runs, 2);
        assert.deepStrictEqual([removed.status, removed.queuePosition], ["cancelled", null]);
        assert.strictEqual(runOf(projection.runs, 1).status, "interrupted");
        assert.deepStrictEqual(queuedTexts(projection), []);
      }),
    );

    it.effect("a run that ends starts the next queued message", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;
        const before = yield* queueBehindFirst(harness, 3);

        yield* interrupt(harness, runOf(before.runs, 1));
        yield* awaitRunStatus(harness, 2, "starting");

        const projection = yield* threadOf(harness);
        assert.deepStrictEqual(
          [runOf(projection.runs, 2).status, runOf(projection.runs, 2).queuePosition],
          ["starting", null],
        );
        assert.strictEqual(runOf(projection.runs, 3).status, "queued");
        const started = projection.turnItems.findLast((item) => item.type === "user_message");
        assert.deepStrictEqual(
          started?.type === "user_message" ? [started.text, started.inputIntent] : [],
          ["Message 2", "queued_turn"],
        );
      }),
    );

    it.effect("Stop holds the queue until it is resumed", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;
        const before = yield* queueBehindFirst(harness, 3);

        yield* interrupt(harness, runOf(before.runs, 1), true);
        const held = yield* threadOf(harness);
        // A message sent while nothing runs starts at once, ahead of the held queue, as in T3 Code.
        yield* send(harness, 4, { dispatchMode: { type: "queue_after_active" } });

        assert.deepStrictEqual(
          [runOf(held.runs, 2), runOf(held.runs, 3)].map((run) => [run.status, run.queueHeld]),
          [
            ["queued", true],
            ["queued", true],
          ],
        );
        assert.strictEqual(runOf((yield* threadOf(harness)).runs, 4).status, "starting");

        yield* interrupt(harness, runOf((yield* threadOf(harness)).runs, 4), true);
        yield* resume(harness);
        const resumed = yield* threadOf(harness);
        assert.strictEqual(runOf(resumed.runs, 2).status, "starting");
        assert.deepStrictEqual(
          [runOf(resumed.runs, 3).status, runOf(resumed.runs, 3).queueHeld],
          ["queued", false],
        );
      }),
    );

    it.effect("a run that fails holds the queue", () =>
      Effect.gen(function* () {
        const harness = yield* withThread(
          yield* makeHarness({
            claudeRunner: {
              ...NO_TURN,
              allocateSessionId: Effect.fail(
                new ClaudeAgentSdkQueryRunnerError({
                  method: "allocateSessionId",
                  cause: "Claude Code is not signed in.",
                }),
              ),
            },
          }),
        );
        yield* queueBehindFirst(harness, 2);

        yield* harness.worker.drain;
        yield* awaitRunStatus(harness, 1, "failed");
        yield* awaitRunStatus(harness, 2, "queued").pipe(
          Effect.andThen(
            harness.eventStore.streamApplicationEvents({ afterSequence: 0 }).pipe(
              Stream.filter(
                (stored) =>
                  stored.aggregateKind === "thread" &&
                  stored.event.type === "run.updated" &&
                  stored.event.payload.queueHeld === true,
              ),
              Stream.runHead,
            ),
          ),
        );

        const projection = yield* threadOf(harness);
        assert.deepStrictEqual(
          [runOf(projection.runs, 2).status, runOf(projection.runs, 2).queueHeld],
          ["queued", true],
        );
      }),
    );

    it.effect("a restart holds the queue, and settles the run it was waiting for", () =>
      Effect.gen(function* () {
        const config = yield* makeTestServerConfig();
        const first = yield* withThread(yield* makeHarness({ config }));
        yield* queueBehindFirst(first, 2);

        // The first server is gone without settling anything; a new one starts over its home.
        const second = yield* makeHarness({ config, recoverOnStartup: true });

        const projection = Option.getOrThrow(
          yield* second.orchestrator.getThreadProjection(THREAD_ID),
        );
        assert.strictEqual(runOf(projection.runs, 1).status, "cancelled");
        assert.deepStrictEqual(
          [runOf(projection.runs, 2).status, runOf(projection.runs, 2).queueHeld],
          ["queued", true],
        );
      }),
    );

    it.effect(
      "a queued run keeps its own model selection, and the thread takes it when it starts",
      () =>
        Effect.gen(function* () {
          const harness = yield* harnessWithThread;
          const low: ModelSelection = { ...HAIKU, options: [{ id: "effort", value: "low" }] };
          yield* send(harness, 1, { dispatchMode: { type: "start_immediately" } });
          yield* send(harness, 2, { modelSelection: low });

          const queued = yield* threadOf(harness);
          assert.deepStrictEqual(runOf(queued.runs, 2).modelSelection, low);
          assert.deepStrictEqual(queued.thread.modelSelection, HAIKU);

          yield* interrupt(harness, runOf(queued.runs, 1));
          yield* awaitRunStatus(harness, 2, "starting");
          assert.deepStrictEqual((yield* threadOf(harness)).thread.modelSelection, low);
        }),
    );

    it.effect("Resume continues an interrupted run past a queued message removed after it", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;
        const before = yield* queueBehindFirst(harness, 2);
        yield* harness.orchestrator.dispatch({
          type: "queued-run.cancel",
          commandId: CommandId.make("command:queue:cancel"),
          threadId: THREAD_ID,
          runId: runOf(before.runs, 2).id,
        });
        yield* interrupt(harness, runOf(before.runs, 1), true);

        yield* harness.orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("command:queue:continue"),
          threadId: THREAD_ID,
          messageId: MessageId.make("message:queue:continue"),
          text: "Continue where you left off.",
          dispatchMode: { type: "start_immediately" },
          manualContinuationOfRunId: runOf(before.runs, 1).id,
        });

        assert.strictEqual((yield* threadOf(harness)).runs.at(-1)?.status, "starting");
      }),
    );

    it.effect("Resume continues an interrupted run, and only the latest one", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;
        const first = yield* queueBehindFirst(harness, 1);
        yield* interrupt(harness, runOf(first.runs, 1), true);
        const continueFrom = (n: number, runId: OrchestrationV2Run["id"]) =>
          harness.orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make(`command:queue:continue:${n}`),
            threadId: THREAD_ID,
            messageId: MessageId.make(`message:queue:continue:${n}`),
            text: "Continue where you left off.",
            dispatchMode: { type: "start_immediately" },
            manualContinuationOfRunId: runId,
          });

        yield* continueFrom(1, runOf(first.runs, 1).id);
        const continued = (yield* threadOf(harness)).runs.at(-1)!;
        yield* interrupt(harness, continued, true);
        const refused = yield* Effect.flip(continueFrom(2, runOf(first.runs, 1).id));

        assert.strictEqual(continued.status, "starting");
        assert.strictEqual(refused.message, "This thread can no longer be resumed from that run.");
      }),
    );
  });
});

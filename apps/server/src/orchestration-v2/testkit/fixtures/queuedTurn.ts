import {
  CommandId,
  MessageId,
  ProjectId,
  type RunId,
  ThreadId,
} from "@playstead/contracts/baseSchemas";
import type {
  MessageDispatchMode,
  ModelSelection,
  OrchestrationV2Run,
} from "@playstead/contracts/orchestrationV2";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import type { makeOrchestrationHarness } from "../OrchestratorHarness.ts";

/**
 * The queue, through a provider (T3 Code's `queued_turn` and
 * `queued_cancelled_while_active` fixtures at 2577baf, and Stop with a
 * queue held, in one thread):
 *
 * 1. Message one starts; message two is queued behind it with its own
 *    reasoning effort, and message three is queued and removed while one
 *    is still active. When one ends, two starts as a turn of its own, with
 *    two's effort; three never does.
 * 2. Message four starts, five is queued behind it, and **Stop** ends four
 *    before its provider turn starts, holding five. **Resume** starts five.
 *
 * The provider sees the turns for one, two and five. Each provider's
 * recorder runs it against the signed-in CLI; the queue replay tests run it
 * again over the recordings.
 */
export interface QueuedTurnScenario {
  readonly scenario: "queued_turn";
  readonly instanceId: ModelSelection["instanceId"];
  readonly model: string;
  /** The options message two carries, which its queued run keeps. */
  readonly queuedOptions: NonNullable<ModelSelection["options"]>;
}

export const CLAUDE_QUEUED_TURN_SCENARIO = {
  scenario: "queued_turn",
  instanceId: "claudeAgent",
  model: "claude-haiku-5-5",
  queuedOptions: [{ id: "effort", value: "low" }],
} as const satisfies QueuedTurnScenario;

export const CODEX_QUEUED_TURN_SCENARIO = {
  scenario: "queued_turn",
  instanceId: "codex",
  model: "gpt-5.6-terra",
  queuedOptions: [{ id: "reasoningEffort", value: "low" }],
} as const satisfies QueuedTurnScenario;

const WORDS = ["one", "two", "three", "four", "five"] as const;

/** What message `n` asks; the reply is the word. */
export const queuedTurnPrompt = (n: number) => `Reply with just the word: ${WORDS[n - 1]}.`;

export const QUEUED_TURN_IDS = {
  projectId: ProjectId.make("project:queued-turn"),
  threadId: ThreadId.make("thread:queued-turn"),
  messageId: (n: number) => MessageId.make(`message:queued-turn:${n}`),
} as const;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

/** Waits, without sleeping, for message `n`'s run to reach a status `accepts` takes. */
const awaitRun = (
  harness: Harness,
  n: number,
  accepts: (status: OrchestrationV2Run["status"]) => boolean,
) =>
  harness.eventStore.streamApplicationEvents({ afterSequence: 0 }).pipe(
    Stream.filter(
      (stored) =>
        stored.aggregateKind === "thread" &&
        stored.event.type === "run.updated" &&
        stored.event.payload.userMessageId === QUEUED_TURN_IDS.messageId(n) &&
        accepts(stored.event.payload.status),
    ),
    Stream.runHead,
    Effect.flatMap((stored) =>
      Option.isSome(stored) &&
      stored.value.aggregateKind === "thread" &&
      stored.value.event.type === "run.updated"
        ? Effect.succeed(stored.value.event.payload)
        : Effect.die("The event stream ended before the run did."),
    ),
  );

const ENDED = (status: OrchestrationV2Run["status"]) =>
  status === "completed" ||
  status === "interrupted" ||
  status === "failed" ||
  status === "cancelled";

const runIdOf = (harness: Harness, n: number) =>
  Effect.gen(function* () {
    const projection = Option.getOrThrow(
      yield* harness.orchestrator.getThreadProjection(QUEUED_TURN_IDS.threadId),
    );
    const run = projection.runs.find(
      (candidate) => candidate.userMessageId === QUEUED_TURN_IDS.messageId(n),
    );
    return run === undefined ? yield* Effect.die(`Message ${n} has no run.`) : run.id;
  });

export const runQueuedTurnScenario = (harness: Harness, scenario: QueuedTurnScenario) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(harness.home, "queue-game");
    yield* fs.makeDirectory(folder);
    yield* harness.projects.create({
      commandId: CommandId.make("command:queued-turn:project"),
      projectId: QUEUED_TURN_IDS.projectId,
      title: "queue-game",
      workspaceRoot: folder,
    });
    const selection: ModelSelection = { instanceId: scenario.instanceId, model: scenario.model };
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:queued-turn:thread"),
      threadId: QUEUED_TURN_IDS.threadId,
      projectId: QUEUED_TURN_IDS.projectId,
      title: "New thread",
      modelSelection: selection,
      runtimeMode: "full-access",
    });
    const send = (n: number, dispatchMode: MessageDispatchMode, modelSelection = selection) =>
      harness.orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`command:queued-turn:message:${n}`),
        threadId: QUEUED_TURN_IDS.threadId,
        messageId: QUEUED_TURN_IDS.messageId(n),
        text: queuedTurnPrompt(n),
        dispatchMode,
        modelSelection,
      });
    const command = (name: string) => CommandId.make(`command:queued-turn:${name}`);

    // 1. Two waits behind one, with its own effort; three is removed while one runs.
    yield* send(1, { type: "start_immediately" });
    yield* send(
      2,
      { type: "queue_after_active" },
      { ...selection, options: scenario.queuedOptions },
    );
    yield* send(3, { type: "queue_after_active" });
    yield* harness.orchestrator.dispatch({
      type: "queued-run.cancel",
      commandId: command("cancel:3"),
      threadId: QUEUED_TURN_IDS.threadId,
      runId: yield* runIdOf(harness, 3),
    });
    yield* harness.worker.drain;
    const one = yield* awaitRun(harness, 1, ENDED);
    yield* awaitRun(harness, 2, (status) => status === "starting");
    yield* harness.worker.drain;
    const two = yield* awaitRun(harness, 2, ENDED);

    // 2. Stop holds five behind four; Resume starts it.
    yield* send(4, { type: "start_immediately" });
    yield* send(5, { type: "queue_after_active" });
    const four: RunId = yield* runIdOf(harness, 4);
    yield* harness.orchestrator.dispatch({
      type: "run.interrupt",
      commandId: command("stop:4"),
      threadId: QUEUED_TURN_IDS.threadId,
      runId: four,
      holdQueue: true,
    });
    const startedWhileHeld = yield* harness.worker.drain;
    const held = Option.getOrThrow(
      yield* harness.orchestrator.getThreadProjection(QUEUED_TURN_IDS.threadId),
    );
    yield* harness.orchestrator.dispatch({
      type: "queue.resume",
      commandId: command("resume"),
      threadId: QUEUED_TURN_IDS.threadId,
    });
    yield* harness.worker.drain;
    const five = yield* awaitRun(harness, 5, ENDED);
    return { workspace: folder, one, two, five, held, startedWhileHeld };
  });

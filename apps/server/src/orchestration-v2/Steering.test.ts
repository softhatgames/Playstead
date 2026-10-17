import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type {
  ModelSelection,
  OrchestrationV2Command,
  OrchestrationV2Run,
} from "@playstead/contracts/orchestrationV2";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import type { ClaudeAgentSdkQueryRunner } from "./Adapters/ClaudeAdapterV2.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import { replayClaude, replayCodex } from "./testkit/ProviderReplay.ts";
import {
  CLAUDE_MESSAGE_STEERING_SCENARIO,
  CODEX_MESSAGE_STEERING_SCENARIO,
  MESSAGE_STEERING_IDS,
  type MessageSteeringScenario,
  type MessageSteeringVariant,
  runMessageSteeringScenario,
} from "./testkit/fixtures/messageSteering.ts";

/** Seam 1 with Claude's `query()` replaying the steering recording. */
const claudeReplay = replayClaude("message_steering.claude.ndjson", { workspace: "steer-game" });

/** The same with Codex's app-server replayed. */
const codexReplay = replayCodex("message_steering.codex.ndjson", { workspace: "steer-game" });

/**
 * Runs the steering scenario over a replay and checks what the person
 * sees. The replay itself checks that the steer reached the running turn
 * (Codex's `turn/steer` with the turn's id, Claude's message with priority
 * `now`) and that the late steer never did.
 */
const steering = <E>(
  replay: {
    readonly harness: Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;
    readonly assertComplete: Effect.Effect<void, E>;
  },
  scenario: MessageSteeringScenario,
  variant: MessageSteeringVariant,
) =>
  Effect.gen(function* () {
    const { harness } = replay;

    const result = yield* runMessageSteeringScenario(harness, scenario, variant);

    yield* replay.assertComplete;
    const projection = Option.getOrThrow(
      yield* harness.orchestrator.getThreadProjection(MESSAGE_STEERING_IDS.threadId),
    );
    assert.deepStrictEqual(
      [result.steered.status, result.three.status, result.late.status],
      ["completed", "completed", "completed"],
    );
    // Two joined one's run; four has a run of its own.
    assert.deepStrictEqual(
      projection.runs.map((run) => [
        projection.messages.find((message) => message.id === run.userMessageId)?.text ===
        scenario.prompts.steer
          ? "two"
          : run.userMessageId,
        run.status,
      ]),
      [
        [MESSAGE_STEERING_IDS.messageId(1), "completed"],
        ...(variant.steerBy === "promotion" ? [["two", "cancelled"]] : []),
        [MESSAGE_STEERING_IDS.messageId(3), "completed"],
        [MESSAGE_STEERING_IDS.messageId(4), "completed"],
      ],
    );
    assert.deepStrictEqual(
      projection.turnItems.flatMap((item) =>
        item.type === "user_message"
          ? [[item.messageId, item.inputIntent, item.runId === result.steered.id]]
          : [],
      ),
      [
        [MESSAGE_STEERING_IDS.messageId(1), "turn_start", true],
        [
          MESSAGE_STEERING_IDS.messageId(2),
          variant.steerBy === "promotion" ? "promoted_queued_to_steer" : "steer",
          true,
        ],
        [MESSAGE_STEERING_IDS.messageId(3), "turn_start", false],
        [MESSAGE_STEERING_IDS.messageId(4), "turn_start", false],
      ],
    );
    assert.strictEqual(
      projection.messages.find((message) => message.id === MESSAGE_STEERING_IDS.messageId(2))
        ?.runId,
      result.steered.id,
    );
    const replies = projection.turnItems.flatMap((item) =>
      item.type === "assistant_message" ? [[item.runId, item.text.toLowerCase()] as const] : [],
    );
    const repliedIn = (run: OrchestrationV2Run, word: string) =>
      replies.some(([runId, text]) => runId === run.id && text.includes(word));
    assert.deepStrictEqual(
      [
        repliedIn(result.steered, "steered"),
        repliedIn(result.three, "three"),
        repliedIn(result.late, "four"),
      ],
      [true, true, true],
    );
  });

const PROJECT_ID = ProjectId.make("project:steering");
const THREAD_ID = ThreadId.make("thread:steering");
const HAIKU: ModelSelection = { instanceId: "claudeAgent", model: "claude-haiku-5-5" };

/** Seam 1 without a provider turn: the effect worker is never drained, so every run stays `starting`. */
const NO_TURN: ClaudeAgentSdkQueryRunner["Service"] = {
  allocateSessionId: Effect.die("No turn starts in this test."),
  open: () => Effect.die("No turn starts in this test."),
};

const harnessWithThread = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const harness = yield* makeOrchestrationHarness({ claudeRunner: NO_TURN });
  const folder = path.join(harness.home, "game");
  yield* fs.makeDirectory(folder);
  yield* harness.projects.create({
    commandId: CommandId.make("command:steering:project"),
    projectId: PROJECT_ID,
    title: "game",
    workspaceRoot: folder,
  });
  yield* harness.orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make("command:steering:thread"),
    threadId: THREAD_ID,
    projectId: PROJECT_ID,
    title: "New thread",
    modelSelection: HAIKU,
    runtimeMode: "full-access",
  });
  return harness;
});

type Harness = Effect.Success<typeof harnessWithThread>;

const send = (
  harness: Harness,
  n: number,
  delivery: Pick<
    Extract<OrchestrationV2Command, { type: "message.dispatch" }>,
    "dispatchMode" | "deliveryIntent"
  >,
) =>
  harness.orchestrator.dispatch({
    type: "message.dispatch",
    commandId: CommandId.make(`command:steering:message:${n}`),
    threadId: THREAD_ID,
    messageId: MessageId.make(`message:steering:${n}`),
    text: `Message ${n}`,
    ...delivery,
  });

const threadOf = (harness: Harness) =>
  Effect.map(harness.orchestrator.getThreadProjection(THREAD_ID), Option.getOrThrow);

const runOf = (runs: ReadonlyArray<OrchestrationV2Run>, n: number) => {
  const run = runs.find((candidate) => candidate.userMessageId === `message:steering:${n}`);
  assert.isDefined(run);
  return run!;
};

describe("Steering", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("Codex steers the running turn, and a steer too late starts a turn of its own", () =>
      Effect.flatMap(codexReplay, (replay) =>
        steering(replay, CODEX_MESSAGE_STEERING_SCENARIO, {
          steerBy: "message",
          lateSteer: "while_shown_running",
        }),
      ),
    );

    it.effect("Claude steers the running turn, and a steer too late starts a turn of its own", () =>
      Effect.flatMap(claudeReplay, (replay) =>
        steering(replay, CLAUDE_MESSAGE_STEERING_SCENARIO, {
          steerBy: "message",
          lateSteer: "while_shown_running",
        }),
      ),
    );

    it.effect(
      "Codex steers with a promoted queued message, and after its turn ended starts one",
      () =>
        Effect.flatMap(codexReplay, (replay) =>
          steering(replay, CODEX_MESSAGE_STEERING_SCENARIO, {
            steerBy: "promotion",
            lateSteer: "after_ended",
          }),
        ),
    );

    it.effect(
      "Claude steers with a promoted queued message, and after its turn ended starts one",
      () =>
        Effect.flatMap(claudeReplay, (replay) =>
          steering(replay, CLAUDE_MESSAGE_STEERING_SCENARIO, {
            steerBy: "promotion",
            lateSteer: "after_ended",
          }),
        ),
    );

    it.effect("a steer while the run is still starting is refused", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;
        yield* send(harness, 1, { dispatchMode: { type: "start_immediately" } });
        const first = runOf((yield* threadOf(harness)).runs, 1);

        const refused = yield* Effect.flip(
          send(harness, 2, { dispatchMode: { type: "steer_active", targetRunId: first.id } }),
        );

        assert.strictEqual(
          refused.message,
          `Target run ${first.id} is starting and cannot be steered.`,
        );
        assert.deepStrictEqual(
          (yield* threadOf(harness)).messages.map((message) => message.text),
          ["Message 1"],
        );
      }),
    );

    it.effect("a message sent as a steer while nothing runs starts a run", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;

        yield* send(harness, 1, {
          dispatchMode: { type: "start_immediately" },
          deliveryIntent: "steer",
        });

        assert.strictEqual(runOf((yield* threadOf(harness)).runs, 1).status, "starting");
      }),
    );

    it.effect("a message sent with automatic delivery waits behind a run still starting", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;
        yield* send(harness, 1, { dispatchMode: { type: "start_immediately" } });

        yield* send(harness, 2, {
          dispatchMode: { type: "start_immediately" },
          deliveryIntent: "auto",
        });

        assert.strictEqual(runOf((yield* threadOf(harness)).runs, 2).status, "queued");
      }),
    );

    it.effect("a queued message promoted while the run is still starting stays queued", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread;
        yield* send(harness, 1, { dispatchMode: { type: "start_immediately" } });
        yield* send(harness, 2, { dispatchMode: { type: "queue_after_active" } });
        const before = yield* threadOf(harness);
        const promote = (queuedRunId: OrchestrationV2Run["id"], n: number) =>
          harness.orchestrator.dispatch({
            type: "queued-message.promote-to-steer",
            commandId: CommandId.make(`command:steering:promote:${n}`),
            threadId: THREAD_ID,
            queuedRunId,
            targetRunId: runOf(before.runs, 1).id,
          });

        const starting = yield* Effect.flip(promote(runOf(before.runs, 2).id, 1));
        const notQueued = yield* Effect.flip(promote(runOf(before.runs, 1).id, 2));

        assert.strictEqual(
          starting.message,
          `Target run ${runOf(before.runs, 1).id} is starting and cannot be steered.`,
        );
        assert.strictEqual(
          notQueued.message,
          `Queued run ${runOf(before.runs, 1).id} is not queued.`,
        );
        const after = yield* threadOf(harness);
        assert.deepStrictEqual(
          [runOf(after.runs, 2).status, runOf(after.runs, 2).queuePosition],
          ["queued", 1],
        );
      }),
    );
  });
});

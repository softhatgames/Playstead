import {
  CommandId,
  MessageId,
  ProjectId,
  type RunId,
  ThreadId,
} from "@playstead/contracts/baseSchemas";
import type {
  MessageDispatchMode,
  OrchestrationDispatchCommandError,
  OrchestrationV2Command,
  OrchestrationV2DomainEvent,
  OrchestrationV2Run,
} from "@playstead/contracts/orchestrationV2";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import type * as Orchestrator from "../../Orchestrator.ts";
import type { makeOrchestrationHarness } from "../OrchestratorHarness.ts";
import { projectionOf } from "../ThreadCommands.ts";

/**
 * Steering, through a provider (T3 Code's `message_steering` fixture at
 * 2577baf, and the steer that arrives too late, in one thread):
 *
 * 1. Message one asks for a long command; once the command runs, message
 *    two steers the turn (`deliveryIntent: "steer"`, as the composer sends
 *    it). The provider gets it inside the same turn, and the turn answers
 *    it: one run, two messages.
 * 2. Message three's turn ends at the provider while the server still shows
 *    it running, and message four is sent as a steer then. By the time the
 *    steer would reach the provider the turn has ended, so message four
 *    starts a turn of its own (T3 Code's steer follow-up). The provider never
 *    sees a steer for it.
 *
 * A late steer can also be sent after the server has seen the turn end, as
 * a person who saw it running a moment before would; it then starts its
 * own turn at once. The provider sees the same either way, so the replay
 * tests run that variant over the same recording.
 */
export interface MessageSteeringScenario {
  readonly scenario: "message_steering";
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly prompts: {
    readonly long: string;
    readonly steer: string;
    readonly short: string;
    readonly late: string;
  };
}

export const CLAUDE_MESSAGE_STEERING_SCENARIO = {
  scenario: "message_steering",
  instanceId: "claudeAgent",
  model: "claude-haiku-5-5",
  prompts: {
    long: 'Use your Bash tool to run `node -e "setTimeout(() => {}, 20000)"` in the foreground, then reply with the single word: slept',
    steer: "Change of plan: do not wait for the command. Reply with the single word: steered",
    short: "Reply with the single word: three",
    late: "Reply with the single word: four",
  },
} as const satisfies MessageSteeringScenario;

export const CODEX_MESSAGE_STEERING_SCENARIO = {
  scenario: "message_steering",
  instanceId: "codex",
  model: "gpt-5.6-terra",
  prompts: {
    long: 'Run the shell command `node -e "setTimeout(() => {}, 10000)"`, then reply with the single word: slept',
    steer: "Change of plan: once the command is done, reply with the single word: steered",
    short: "Reply with the single word: three",
    late: "Reply with the single word: four",
  },
} as const satisfies MessageSteeringScenario;

export const MESSAGE_STEERING_IDS = {
  projectId: ProjectId.make("project:message-steering"),
  threadId: ThreadId.make("thread:message-steering"),
  messageId: (n: number) => MessageId.make(`message:message-steering:${n}`),
} as const;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

/** The run message `n` started. */
const runOf = (harness: Harness, n: number) =>
  Effect.gen(function* () {
    const run = (yield* projectionOf(harness, MESSAGE_STEERING_IDS.threadId)).runs.find(
      (candidate) => candidate.userMessageId === MESSAGE_STEERING_IDS.messageId(n),
    );
    return run === undefined ? yield* Effect.die(`Message ${n} has no run.`) : run;
  });

/** Waits, without sleeping, for the event `matches` picks out. */
const awaitEvent = (harness: Harness, matches: (event: OrchestrationV2DomainEvent) => boolean) =>
  harness.eventStore.streamApplicationEvents({ afterSequence: 0 }).pipe(
    Stream.filter(
      (stored) =>
        stored.aggregateKind === "thread" &&
        stored.event.threadId === MESSAGE_STEERING_IDS.threadId &&
        matches(stored.event),
    ),
    Stream.runHead,
    Effect.flatMap((found) =>
      Option.isSome(found) ? Effect.void : Effect.die("The event stream ended first."),
    ),
  );

const ENDED: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
]);

/** Waits for message `n`'s run to end, and returns it. */
const awaitRunEnded = (harness: Harness, n: number) =>
  awaitEvent(
    harness,
    (event) =>
      event.type === "run.updated" &&
      event.payload.userMessageId === MESSAGE_STEERING_IDS.messageId(n) &&
      ENDED.has(event.payload.status),
  ).pipe(Effect.andThen(runOf(harness, n)));

export interface MessageSteeringVariant {
  /**
   * How message two steers: sent as a steer, or queued and then promoted
   * with its **Steer** button (`queued-message.promote-to-steer`). The
   * provider gets the same steer either way.
   */
  readonly steerBy: "message" | "promotion";
  /** When the late steer is sent: while the server still shows three's turn running, or after it ended. */
  readonly lateSteer: "while_shown_running" | "after_ended";
  /**
   * What the person does to the thread while one's command runs, before two
   * steers it (snoozing it, say). It must not reach the provider.
   */
  readonly beforeSteer?: (
    harness: Harness,
  ) => Effect.Effect<
    void,
    OrchestrationDispatchCommandError | Orchestrator.OrchestratorDispatchError
  >;
}

/** How the recorders run it. */
const RECORDED_STEERING: MessageSteeringVariant = {
  steerBy: "message",
  lateSteer: "while_shown_running",
};

export const runMessageSteeringScenario = (
  harness: Harness,
  scenario: MessageSteeringScenario,
  variant: MessageSteeringVariant = RECORDED_STEERING,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(harness.home, "steer-game");
    yield* fs.makeDirectory(folder);
    yield* harness.projects.create({
      commandId: CommandId.make("command:message-steering:project"),
      projectId: MESSAGE_STEERING_IDS.projectId,
      title: "steer-game",
      workspaceRoot: folder,
    });
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:message-steering:thread"),
      threadId: MESSAGE_STEERING_IDS.threadId,
      projectId: MESSAGE_STEERING_IDS.projectId,
      title: "New thread",
      modelSelection: { instanceId: scenario.instanceId, model: scenario.model },
      runtimeMode: "full-access",
    });
    const send = (
      n: number,
      text: string,
      delivery: Pick<
        Extract<OrchestrationV2Command, { type: "message.dispatch" }>,
        "dispatchMode" | "deliveryIntent"
      >,
    ) =>
      harness.orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`command:message-steering:message:${n}`),
        threadId: MESSAGE_STEERING_IDS.threadId,
        messageId: MESSAGE_STEERING_IDS.messageId(n),
        text,
        ...delivery,
      });
    const START: { readonly dispatchMode: MessageDispatchMode } = {
      dispatchMode: { type: "start_immediately" },
    };
    // What the composer sends while its follow-up behaviour is Steer.
    const STEER = { dispatchMode: { type: "start_immediately" }, deliveryIntent: "steer" } as const;

    // 1. Two steers one's turn once its command runs.
    yield* send(1, scenario.prompts.long, START);
    yield* harness.worker.drain;
    yield* awaitEvent(
      harness,
      (event) =>
        event.type === "turn-item.updated" &&
        event.payload.type === "command_execution" &&
        event.payload.status === "running",
    );
    if (variant.beforeSteer !== undefined) yield* variant.beforeSteer(harness);
    if (variant.steerBy === "message") {
      yield* send(2, scenario.prompts.steer, STEER);
    } else {
      yield* send(2, scenario.prompts.steer, { dispatchMode: { type: "queue_after_active" } });
      yield* harness.orchestrator.dispatch({
        type: "queued-message.promote-to-steer",
        commandId: CommandId.make("command:message-steering:promote:2"),
        threadId: MESSAGE_STEERING_IDS.threadId,
        queuedRunId: (yield* runOf(harness, 2)).id,
        targetRunId: (yield* runOf(harness, 1)).id,
      });
    }
    yield* harness.worker.drain;
    const steered = yield* awaitRunEnded(harness, 1);

    // 2. Four is sent as a steer too late for three's turn.
    const three: { run?: OrchestrationV2Run } = {};
    if (variant.lateSteer === "while_shown_running") {
      const hold = yield* harness.holdNextTurnEnd;
      yield* send(3, scenario.prompts.short, START);
      yield* harness.worker.drain;
      yield* hold.reached;
      yield* send(4, scenario.prompts.late, STEER);
      yield* hold.release;
      three.run = yield* awaitRunEnded(harness, 3);
    } else {
      yield* send(3, scenario.prompts.short, START);
      yield* harness.worker.drain;
      three.run = yield* awaitRunEnded(harness, 3);
      const target: RunId = three.run.id;
      yield* send(4, scenario.prompts.late, {
        dispatchMode: { type: "steer_active", targetRunId: target },
      });
    }
    // The steer's effect finds the turn ended and starts four's run, whose
    // turn the same drain starts.
    yield* harness.worker.drain;
    const late = yield* awaitRunEnded(harness, 4);
    return { workspace: folder, steered, three: three.run, late };
  });

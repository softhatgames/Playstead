import {
  CommandId,
  MessageId,
  ProjectId,
  type RunId,
  ThreadId,
} from "@playstead/contracts/baseSchemas";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import type { makeOrchestrationHarness } from "../OrchestratorHarness.ts";

/**
 * The interrupted turn (T3 Code's `turn_interrupt` fixture at 2577baf, plus
 * the message after it): a thread is asked for a long shell command, is
 * interrupted once the command is running, and then answers a short
 * message. Each provider's recorder runs it against the signed-in CLI; the
 * replay tests run it again over the recordings.
 */
export interface TurnInterruptScenario {
  readonly scenario: string;
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly longPrompt: string;
  readonly nextPrompt: string;
  /** The word the reply to `nextPrompt` holds. */
  readonly nextReply: string;
}

export const CLAUDE_TURN_INTERRUPT_SCENARIO = {
  scenario: "turn_interrupt",
  instanceId: "claudeAgent",
  model: "claude-haiku-5-5",
  longPrompt:
    'Use your Bash tool to run `node -e "setTimeout(() => {}, 30000)"` in the foreground, then reply with the single word: slept',
  nextPrompt: "Reply with the single word: ready",
  nextReply: "ready",
} as const satisfies TurnInterruptScenario;

export const CODEX_TURN_INTERRUPT_SCENARIO = {
  scenario: "turn_interrupt",
  instanceId: "codex",
  model: "gpt-5.6-terra",
  longPrompt:
    'Run the shell command `node -e "setTimeout(() => {}, 30000)"`, then reply with the single word: slept',
  nextPrompt: "Reply with the single word: ready",
  nextReply: "ready",
} as const satisfies TurnInterruptScenario;

export const TURN_INTERRUPT_IDS = {
  projectId: ProjectId.make("project:turn-interrupt"),
  threadId: ThreadId.make("thread:turn-interrupt"),
  longMessageId: MessageId.make("message:turn-interrupt:1"),
  nextMessageId: MessageId.make("message:turn-interrupt:2"),
} as const;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

/** Sends the long message; its run is then starting. */
export const sendLongMessage = (harness: Harness, scenario: TurnInterruptScenario) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(harness.home, "empty-game");
    yield* fs.makeDirectory(folder);
    yield* harness.projects.create({
      commandId: CommandId.make("command:turn-interrupt:project"),
      projectId: TURN_INTERRUPT_IDS.projectId,
      title: "empty-game",
      workspaceRoot: folder,
    });
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:turn-interrupt:thread"),
      threadId: TURN_INTERRUPT_IDS.threadId,
      projectId: TURN_INTERRUPT_IDS.projectId,
      title: "New thread",
      modelSelection: { instanceId: scenario.instanceId, model: scenario.model },
      runtimeMode: "full-access",
    });
    const sent = yield* harness.orchestrator.dispatch({
      type: "message.dispatch",
      dispatchMode: { type: "start_immediately" },
      commandId: CommandId.make("command:turn-interrupt:message:1"),
      threadId: TURN_INTERRUPT_IDS.threadId,
      messageId: TURN_INTERRUPT_IDS.longMessageId,
      text: scenario.longPrompt,
    });
    return { workspace: folder, sent };
  });

/**
 * Waits, without sleeping, until the thread's run shows a command running:
 * the provider's turn has started and is busy.
 */
export const awaitCommandRunning = (harness: Harness, afterSequence: number) =>
  harness.eventStore.streamApplicationEvents({ afterSequence }).pipe(
    Stream.filter(
      (stored) =>
        stored.aggregateKind === "thread" &&
        stored.event.threadId === TURN_INTERRUPT_IDS.threadId &&
        stored.event.type === "turn-item.updated" &&
        stored.event.payload.type === "command_execution" &&
        stored.event.payload.status === "running",
    ),
    Stream.runHead,
    Effect.flatMap((found) =>
      found._tag === "Some" && found.value.aggregateKind === "thread"
        ? Effect.succeed(found.value.event)
        : Effect.die("The event stream ended before a command ran."),
    ),
  );

/** `run.interrupt` for the thread's run, as the composer's **Interrupt** sends it. */
export const interruptRun = (harness: Harness, runId: RunId, attempt = 1) =>
  harness.orchestrator.dispatch({
    type: "run.interrupt",
    commandId: CommandId.make(`command:turn-interrupt:interrupt:${attempt}`),
    threadId: TURN_INTERRUPT_IDS.threadId,
    runId,
  });

/** Sends the short message after the interrupt and waits for its run to end. */
const sendNextMessage = (harness: Harness, scenario: TurnInterruptScenario) =>
  Effect.gen(function* () {
    const sent = yield* harness.orchestrator.dispatch({
      type: "message.dispatch",
      dispatchMode: { type: "start_immediately" },
      commandId: CommandId.make("command:turn-interrupt:message:2"),
      threadId: TURN_INTERRUPT_IDS.threadId,
      messageId: TURN_INTERRUPT_IDS.nextMessageId,
      text: scenario.nextPrompt,
    });
    yield* harness.worker.drain;
    return yield* harness.awaitRunEnded(TURN_INTERRUPT_IDS.threadId, sent.sequence);
  });

/**
 * The whole scenario: the long message, the interrupt once its command
 * runs, then the next message. Returns both runs as they ended.
 */
export const runTurnInterruptScenario = (harness: Harness, scenario: TurnInterruptScenario) =>
  Effect.gen(function* () {
    const { workspace, sent } = yield* sendLongMessage(harness, scenario);
    yield* harness.worker.drain;
    const command = yield* awaitCommandRunning(harness, sent.sequence);
    const interrupted = yield* interruptRun(harness, command.runId!);
    yield* harness.worker.drain;
    const first = yield* harness.awaitRunEnded(TURN_INTERRUPT_IDS.threadId, interrupted.sequence);
    const next = yield* sendNextMessage(harness, scenario);
    return { workspace, first, next };
  });

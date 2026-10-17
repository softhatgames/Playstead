import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId, type RunId } from "@playstead/contracts/baseSchemas";
import {
  OrchestrationDispatchCommandError,
  type OrchestrationV2ThreadProjection,
} from "@playstead/contracts/orchestrationV2";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
  type ProviderReplayTranscript,
} from "@playstead/provider-testing/replayTranscript";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import { makeClaudeReplay } from "./Adapters/ClaudeAdapterV2.testkit.ts";
import { makeCodexReplay } from "./Adapters/CodexAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import {
  FILE_CREATE_IDS,
  FILE_CREATE_SCENARIO,
  runFileCreateScenario,
} from "./testkit/fixtures/fileCreate.ts";
import {
  awaitCommandRunning,
  CLAUDE_TURN_INTERRUPT_SCENARIO,
  CODEX_TURN_INTERRUPT_SCENARIO,
  interruptRun,
  runTurnInterruptScenario,
  sendLongMessage,
  TURN_INTERRUPT_IDS,
} from "./testkit/fixtures/turnInterrupt.ts";

const fixturePath = (name: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return path.join(
      path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
      "testkit",
      "fixtures",
      name,
    );
  });

const readRecording = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* decodeProviderReplayNdjson(yield* fs.readFileString(yield* fixturePath(name)));
  });

/** Seam 1 with Claude's `query()` replaying a recording made in the harness's folder. */
const claudeReplay = (name: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const recorded = yield* readRecording(name);
    let replay: Effect.Success<ReturnType<typeof makeClaudeReplay>> | undefined;
    const harness = yield* makeOrchestrationHarness({
      claudeRunner: {
        allocateSessionId: Effect.suspend(() => replay!.runner.allocateSessionId),
        open: (input) => Effect.suspend(() => replay!.runner.open(input)),
      },
    });
    replay = yield* makeClaudeReplay(
      yield* materializeReplayWorkspace(recorded, path.join(harness.home, "empty-game")),
    );
    return { harness, replay: replay! };
  });

/** Seam 1 with Codex's app-server replaying a recording made in the harness's folder. */
const codexReplay = (
  name: string,
  edit: (recording: ProviderReplayTranscript) => ProviderReplayTranscript = (recording) =>
    recording,
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const recorded = edit(yield* readRecording(name));
    let replay: Effect.Success<ReturnType<typeof makeCodexReplay>> | undefined;
    const harness = yield* makeOrchestrationHarness({
      codexClients: { open: (input) => Effect.suspend(() => replay!.clients.open(input)) },
    });
    replay = yield* makeCodexReplay(
      yield* materializeReplayWorkspace(recorded, path.join(harness.home, "empty-game")),
    );
    return { harness, replay: replay!, recorded };
  });

/** The `processId` of each command Codex started in a recording. */
const codexCommandProcesses = (recording: ProviderReplayTranscript) =>
  recording.entries.flatMap((entry) => {
    const frame = entry.frame as {
      readonly method?: unknown;
      readonly params?: {
        readonly item?: { readonly type?: unknown; readonly processId?: unknown };
      };
    };
    const item = frame.params?.item;
    return entry.type === "emit_inbound" &&
      frame.method === "item/started" &&
      item?.type === "commandExecution" &&
      typeof item.processId === "string"
      ? [item.processId]
      : [];
  });

/** The `processId` of each background terminal the adapter asked Codex to terminate. */
const codexTerminatedProcesses = (recording: ProviderReplayTranscript) =>
  recording.entries.flatMap((entry) => {
    const frame = entry.frame as {
      readonly method?: unknown;
      readonly params?: { readonly processId?: unknown };
    };
    return entry.type === "expect_outbound" &&
      frame.method === "thread/backgroundTerminals/terminate" &&
      typeof frame.params?.processId === "string"
      ? [frame.params.processId]
      : [];
  });

const threadProjection = (harness: Effect.Success<ReturnType<typeof makeOrchestrationHarness>>) =>
  Effect.map(
    harness.orchestrator.getThreadProjection(TURN_INTERRUPT_IDS.threadId),
    Option.getOrThrow,
  );

/** What T3 Code's `turn_interrupt` fixture asserts, for the interrupted run. */
const assertInterrupted = (projection: OrchestrationV2ThreadProjection, runId: RunId) => {
  const run = projection.runs.find((candidate) => candidate.id === runId);
  assert.strictEqual(run?.status, "interrupted");
  // Replies Claude or Codex wrote before the command are not the interrupt's.
  const items = projection.turnItems.filter(
    (item) => item.runId === runId && item.type !== "assistant_message",
  );
  assert.deepStrictEqual(
    items.map((item) => [item.type, item.status]),
    [
      ["user_message", "completed"],
      ["command_execution", "interrupted"],
      ["run_interrupt_request", "completed"],
      ["run_interrupt_result", "interrupted"],
    ],
  );
  const request = items.find((item) => item.type === "run_interrupt_request");
  const result = items.find((item) => item.type === "run_interrupt_result");
  assert.strictEqual(
    result?.type === "run_interrupt_result" ? result.parentItemId : undefined,
    request?.id,
  );
  const attempt = projection.attempts.find((candidate) => candidate.runId === runId);
  assert.strictEqual(attempt?.status, "interrupted");
  assert.strictEqual(
    projection.nodes.find((node) => node.id === run?.rootNodeId)?.status,
    "interrupted",
  );
  assert.strictEqual(
    projection.providerTurns.find((turn) => turn.runAttemptId === attempt?.id)?.status,
    "interrupted",
  );
};

describe("Interrupt a turn", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "a run interrupted before its provider turn starts ends interrupted, and the next message runs",
      () =>
        Effect.gen(function* () {
          const { harness, replay } = yield* claudeReplay("file_create.claude.ndjson");

          // The first message's run is still starting when it is interrupted,
          // so Claude never sees it; the recording is the second message's.
          const { run, interjected } = yield* runFileCreateScenario(
            harness,
            Effect.gen(function* () {
              const projection = Option.getOrThrow(
                yield* harness.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
              );
              const first = projection.runs[0]!;
              yield* harness.orchestrator.dispatch({
                type: "run.interrupt",
                commandId: CommandId.make("command:interrupt:1"),
                threadId: FILE_CREATE_IDS.threadId,
                runId: first.id,
              });
              return first;
            }),
          );
          assert.strictEqual(run.id, interjected?.id);
          assert.strictEqual(run.status, "interrupted");

          const sent = yield* harness.orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("command:interrupt:again"),
            threadId: FILE_CREATE_IDS.threadId,
            messageId: MessageId.make("message:interrupt:again"),
            text: FILE_CREATE_SCENARIO.prompt,
          });
          yield* harness.worker.drain;
          const next = yield* harness.awaitRunEnded(FILE_CREATE_IDS.threadId, sent.sequence);

          yield* replay.assertComplete;
          assert.strictEqual(next.status, "completed");
          const projection = Option.getOrThrow(
            yield* harness.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
          );
          assert.deepStrictEqual(
            projection.runs.map((candidate) => candidate.status),
            ["interrupted", "completed"],
          );
          const firstRunItems = projection.turnItems.filter((item) => item.runId === run.id);
          assert.deepStrictEqual(
            firstRunItems.map((item) => [item.type, item.status]),
            [
              ["user_message", "completed"],
              ["run_interrupt_request", "completed"],
              ["run_interrupt_result", "interrupted"],
            ],
          );
          const [, request, result] = firstRunItems;
          assert.strictEqual(
            result?.type === "run_interrupt_result" ? result.parentItemId : undefined,
            request?.id,
          );
          assert.deepStrictEqual(
            projection.attempts.map((attempt) => attempt.status),
            ["interrupted", "completed"],
          );
          assert.strictEqual(
            projection.nodes.find((node) => node.id === run.rootNodeId)?.status,
            "interrupted",
          );
        }).pipe(Effect.scoped),
    );

    for (const provider of [
      { name: "Claude", scenario: CLAUDE_TURN_INTERRUPT_SCENARIO },
      { name: "Codex", scenario: CODEX_TURN_INTERRUPT_SCENARIO },
    ] as const) {
      it.effect(
        `${provider.name}: a running turn interrupted through run.interrupt ends interrupted, and the thread accepts the next message`,
        () =>
          Effect.gen(function* () {
            const { harness, replay } =
              provider.name === "Claude"
                ? yield* claudeReplay("turn_interrupt.claude.ndjson")
                : yield* codexReplay("turn_interrupt.codex.ndjson");

            const { first, next } = yield* runTurnInterruptScenario(harness, provider.scenario);

            yield* replay.assertComplete;
            assert.strictEqual(first.status, "interrupted");
            assert.strictEqual(next.status, "completed");
            const projection = yield* threadProjection(harness);
            assertInterrupted(projection, first.id);
            assert.deepStrictEqual(
              projection.runs.map((run) => run.status),
              ["interrupted", "completed"],
            );
            // One provider thread for both runs, idle again: the same session ran the next turn.
            assert.deepStrictEqual(
              projection.providerThreads.map((thread) => thread.status),
              ["idle"],
            );
            assert.strictEqual(projection.providerSessions.length, 1);
            const reply = projection.turnItems.findLast(
              (item) => item.runId === next.id && item.type === "assistant_message",
            );
            assert.match(
              reply?.type === "assistant_message" ? reply.text : "",
              new RegExp(provider.scenario.nextReply, "i"),
            );

            // An ended run cannot be interrupted again.
            const refused = yield* Effect.flip(interruptRun(harness, first.id, 2));
            assert.instanceOf(refused, OrchestrationDispatchCommandError);
            assert.strictEqual(refused.message, `Run ${first.id} has already ended interrupted.`);
          }).pipe(Effect.scoped),
      );
    }

    it.effect(
      "Codex: interrupting a turn stops the command it was running, which Codex's own interrupt leaves running",
      () =>
        Effect.gen(function* () {
          const { harness, replay, recorded } = yield* codexReplay("turn_interrupt.codex.ndjson");

          const { first } = yield* runTurnInterruptScenario(harness, CODEX_TURN_INTERRUPT_SCENARIO);

          // The replay holds the adapter to every frame it was recorded with.
          yield* replay.assertComplete;
          assert.strictEqual(first.status, "interrupted");
          const commands = codexCommandProcesses(recorded);
          assert.lengthOf(commands, 1);
          assert.deepStrictEqual(codexTerminatedProcesses(recorded), commands);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "a turn whose provider never answers the interrupt still ends interrupted, and the thread accepts the next message",
      () =>
        Effect.gen(function* () {
          // Codex as recorded, up to the interrupt: it never answers it.
          const { harness, replay } = yield* codexReplay(
            "turn_interrupt.codex.ndjson",
            (recording) => {
              const at = recording.entries.findIndex(
                (entry) =>
                  entry.type === "expect_outbound" &&
                  (entry.frame as { readonly method?: unknown }).method === "turn/interrupt",
              );
              return { ...recording, entries: recording.entries.slice(0, at + 1) };
            },
          );
          const { sent } = yield* sendLongMessage(harness, CODEX_TURN_INTERRUPT_SCENARIO);
          yield* harness.worker.drain;
          const command = yield* awaitCommandRunning(harness, sent.sequence);
          const interrupted = yield* interruptRun(harness, command.runId!);
          yield* harness.worker.drain;
          const ended = yield* Effect.forkChild(
            harness.awaitRunEnded(TURN_INTERRUPT_IDS.threadId, interrupted.sequence),
          );

          // Ten seconds pass on the test clock, a second at a time.
          for (let second = 0; second < 15 && ended.pollUnsafe() === undefined; second += 1) {
            yield* TestClock.adjust("1 second");
          }
          const run = yield* Fiber.join(ended);

          yield* replay.assertComplete;
          assert.strictEqual(run.status, "interrupted");
          assertInterrupted(yield* threadProjection(harness), run.id);
          const accepted = yield* harness.orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("command:turn-interrupt:message:2"),
            threadId: TURN_INTERRUPT_IDS.threadId,
            messageId: TURN_INTERRUPT_IDS.nextMessageId,
            text: CODEX_TURN_INTERRUPT_SCENARIO.nextPrompt,
          });
          assert.isAbove(accepted.sequence, interrupted.sequence);
        }).pipe(Effect.scoped),
    );
  });
});

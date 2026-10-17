import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import { OrchestrationDispatchCommandError } from "@playstead/contracts/orchestrationV2";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
} from "@playstead/provider-testing/replayTranscript";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { makeClaudeReplay } from "./Adapters/ClaudeAdapterV2.testkit.ts";
import { makeCodexReplay } from "./Adapters/CodexAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import {
  AUTO_MODE_IDS,
  type AutoModeScenario,
  CLAUDE_AUTO_MODE_SCENARIO,
  CODEX_AUTO_MODE_SCENARIO,
  runAutoModeScenario,
} from "./testkit/fixtures/autoMode.ts";

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

/** Seam 1 over a recording made in the harness's folder, with Claude's `query()` replayed. */
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
    return { harness, assertComplete: replay.assertComplete };
  });

/** The same with Codex's app-server replayed. */
const codexReplay = (name: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const recorded = yield* readRecording(name);
    let replay: Effect.Success<ReturnType<typeof makeCodexReplay>> | undefined;
    const harness = yield* makeOrchestrationHarness({
      codexClients: { open: (input) => Effect.suspend(() => replay!.clients.open(input)) },
    });
    replay = yield* makeCodexReplay(
      yield* materializeReplayWorkspace(recorded, path.join(harness.home, "empty-game")),
    );
    return { harness, assertComplete: replay.assertComplete };
  });

/**
 * Runs the Auto scenario over a replay and checks what the person sees: the
 * file written with nobody asked, then the next turn after the change to
 * Full access. The replay itself checks what the adapter sent in each mode.
 */
const autoModeTurns = <E>(
  replay: {
    readonly harness: Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;
    readonly assertComplete: Effect.Effect<void, E>;
  },
  scenario: AutoModeScenario,
) =>
  Effect.gen(function* () {
    const { harness } = replay;

    const { write, next } = yield* runAutoModeScenario(harness, scenario);

    yield* replay.assertComplete;
    assert.strictEqual(write.status, "completed");
    assert.strictEqual(next.status, "completed");
    const projection = Option.getOrThrow(
      yield* harness.orchestrator.getThreadProjection(AUTO_MODE_IDS.threadId),
    );
    const written = projection.turnItems.find((item) => item.type === "file_change");
    assert.strictEqual(written?.type, "file_change");
    if (written?.type === "file_change") {
      assert.strictEqual(written.status, "completed");
      assert.isTrue(written.fileName.endsWith(scenario.fileName));
      assert.strictEqual(written.newStr?.trim(), scenario.content);
    }
    assert.strictEqual(projection.thread.runtimeMode, "full-access");
    assert.deepStrictEqual(projection.runtimeRequests, []);
    const reply = projection.messages.findLast((message) => message.role === "assistant");
    assert.include(reply?.text.toLowerCase(), scenario.nextReply);
    return projection;
  });

const PROJECT_ID = ProjectId.make("project:permission-modes");
const THREAD_ID = ThreadId.make("thread:permission-modes");

/** Seam 1 without a provider turn: Claude's runner is never reached. */
const harnessWithThread = (runtimeMode: "auto" | "full-access") =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const harness = yield* makeOrchestrationHarness({
      claudeRunner: {
        allocateSessionId: Effect.die("No turn starts in this test."),
        open: () => Effect.die("No turn starts in this test."),
      },
    });
    const folder = path.join(harness.home, "game");
    yield* fs.makeDirectory(folder);
    yield* harness.projects.create({
      commandId: CommandId.make("command:permission-modes:project"),
      projectId: PROJECT_ID,
      title: "game",
      workspaceRoot: folder,
    });
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:permission-modes:thread"),
      threadId: THREAD_ID,
      projectId: PROJECT_ID,
      title: "New thread",
      modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
      runtimeMode,
    });
    return harness;
  });

type Harness = Effect.Success<ReturnType<typeof harnessWithThread>>;

const threadOf = (harness: Harness) =>
  Effect.map(harness.orchestrator.getThreadProjection(THREAD_ID), (projection) =>
    Option.getOrThrow(projection),
  );

const setRuntimeMode = (harness: Harness, runtimeMode: "auto" | "full-access", n: number) =>
  harness.orchestrator.dispatch({
    type: "thread.runtime-mode.set",
    commandId: CommandId.make(`command:permission-modes:mode:${n}`),
    threadId: THREAD_ID,
    runtimeMode,
  });

describe("Permission modes", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("a thread runs in the mode it was created with", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread("auto");

        const projection = yield* threadOf(harness);

        assert.strictEqual(projection.thread.runtimeMode, "auto");
      }),
    );

    it.effect("changing the mode is recorded on the thread", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread("full-access");

        yield* setRuntimeMode(harness, "auto", 1);

        const projection = yield* threadOf(harness);
        assert.strictEqual(projection.thread.runtimeMode, "auto");
      }),
    );

    it.effect("the mode can change while a run is active, for the next run", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread("full-access");
        yield* harness.orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("command:permission-modes:message"),
          threadId: THREAD_ID,
          messageId: MessageId.make("message:permission-modes:1"),
          text: "Hello",
        });

        yield* setRuntimeMode(harness, "auto", 1);

        const projection = yield* threadOf(harness);
        assert.strictEqual(projection.runs[0]?.status, "starting");
        assert.strictEqual(projection.thread.runtimeMode, "auto");
      }),
    );

    it.effect("a thread that does not exist has no mode to change", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread("full-access");

        const refused = yield* Effect.flip(
          harness.orchestrator.dispatch({
            type: "thread.runtime-mode.set",
            commandId: CommandId.make("command:permission-modes:missing"),
            threadId: ThreadId.make("thread:missing"),
            runtimeMode: "auto",
          }),
        );

        assert.instanceOf(refused, OrchestrationDispatchCommandError);
        assert.strictEqual(refused.message, "Thread thread:missing does not exist.");
      }),
    );

    it.effect(
      "Codex writes a file in Auto without asking, then runs the next turn in Full access",
      () =>
        Effect.gen(function* () {
          const replay = yield* codexReplay("auto_mode.codex.ndjson");

          const projection = yield* autoModeTurns(replay, CODEX_AUTO_MODE_SCENARIO);

          // One Codex session runs both turns: Codex changes mode on the next turn/start.
          assert.lengthOf(projection.providerSessions, 1);
        }),
    );

    it.effect(
      "Claude writes a file in Auto without asking, then resumes its session in Full access",
      () =>
        Effect.gen(function* () {
          const replay = yield* claudeReplay("auto_mode.claude.ndjson");

          const projection = yield* autoModeTurns(replay, CLAUDE_AUTO_MODE_SCENARIO);

          // Claude's session reopened in the new mode; the first one has stopped.
          assert.deepStrictEqual(
            projection.providerSessions.map((session) => session.status),
            ["stopped", "ready"],
          );
          assert.lengthOf(projection.providerThreads, 1);
        }),
    );
  });
});

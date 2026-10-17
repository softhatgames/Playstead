import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, type ThreadId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2AppThread } from "@playstead/contracts/orchestrationV2";
import { DEFAULT_TEXT_GENERATION_MODEL_SELECTION } from "@playstead/contracts/settings";
import {
  TextGenerationError,
  type ThreadTitleGenerationInput,
  type ThreadTitleGenerationResult,
} from "@playstead/provider-core/server/textGeneration";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
} from "@playstead/provider-testing/replayTranscript";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";

import type * as ServerConfig from "../config.ts";
import { makeTestServerConfig } from "../testUtils/testServer.ts";
import type * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { makeClaudeReplay } from "./Adapters/ClaudeAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import {
  FILE_CREATE_IDS,
  FILE_CREATE_SCENARIO,
  runFileCreateScenario,
  sendFileCreateMessage,
} from "./testkit/fixtures/fileCreate.ts";

/**
 * Seam 1 for generated titles (T3 Code's `ThreadTitleRegenerationService.test.ts`
 * and `ThreadLaunchService.test.ts` title cases at 2577baf): the real
 * orchestrator, effect worker, outbox, settings and projections, with
 * Claude's transport replaying the file-create recording. Text generation
 * stands in for the providers' CLIs, which Seam 2 covers: each request is
 * answered by the next step given, and recorded.
 */

type Step = (
  input: ThreadTitleGenerationInput,
) => Effect.Effect<ThreadTitleGenerationResult, TextGenerationError>;

const title =
  (generated: string): Step =>
  () =>
    Effect.succeed({ title: generated });

const failure: Step = () =>
  Effect.fail(new TextGenerationError({ operation: "generateThreadTitle", detail: "offline" }));

/** Answers once `release` is done, after saying it has started. */
const held = (generated: string) =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const step: Step = () =>
      Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.as({ title: generated }),
      );
    return { step, started, release };
  });

const scriptedTextGeneration = (steps: ReadonlyArray<Step>) =>
  Effect.gen(function* () {
    const requests: Array<ThreadTitleGenerationInput> = [];
    const asked = yield* Queue.unbounded<ThreadTitleGenerationInput>();
    const service: TextGeneration.TextGeneration["Service"] = {
      generateThreadTitle: (input) =>
        Effect.suspend(() => {
          const step = steps[requests.length];
          requests.push(input);
          return Queue.offer(asked, input).pipe(
            Effect.andThen(step === undefined ? Effect.die("No answer left") : step(input)),
          );
        }),
    };
    return { service, requests, asked };
  });

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

const makeHarness = (input: {
  readonly textGeneration: TextGeneration.TextGeneration["Service"];
  readonly config?: ServerConfig.ServerConfig["Service"];
  readonly recoverOnStartup?: boolean;
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const config = input.config ?? (yield* makeTestServerConfig());
    const recorded = yield* readRecording("file_create.claude.ndjson");
    const replay = yield* makeClaudeReplay(
      yield* materializeReplayWorkspace(recorded, path.join(config.baseDir, "empty-game")),
    );
    const harness = yield* makeOrchestrationHarness({
      claudeRunner: replay.runner,
      textGeneration: input.textGeneration,
      config,
      ...(input.recoverOnStartup === undefined ? {} : { recoverOnStartup: input.recoverOnStartup }),
    });
    return { ...harness, config };
  });

type Harness = Effect.Success<ReturnType<typeof makeHarness>>;

const threadOf = (harness: Harness, threadId: ThreadId = FILE_CREATE_IDS.threadId) =>
  Effect.map(
    harness.orchestrator.getThreadProjection(threadId),
    (projection): OrchestrationV2AppThread => Option.getOrThrow(projection).thread,
  );

const threadId = FILE_CREATE_IDS.threadId;
const MESSAGE_COMMAND = "command:file-create:message";

const regenerate = (harness: Harness, id: string) =>
  harness.orchestrator.dispatch({
    type: "thread.metadata.update",
    commandId: CommandId.make(id),
    threadId,
    regenerateTitle: true,
  });

/** Moves the test clock on until the next request arrives, for the retries' waits. */
const nextRequestAfterWaiting = (asked: Queue.Queue<ThreadTitleGenerationInput>) =>
  Effect.raceFirst(
    Queue.take(asked),
    Effect.forever(Effect.andThen(TestClock.adjust("500 millis"), Effect.yieldNow)),
  );

describe("Generated thread titles", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "the first message's seed titles the thread at once, then the provider's title replaces it",
      () =>
        Effect.gen(function* () {
          const text = yield* scriptedTextGeneration([title("Hello file from Claude")]);
          const harness = yield* makeHarness({ textGeneration: text.service });

          const { workspace } = yield* sendFileCreateMessage(harness);
          const seeded = yield* threadOf(harness);
          assert.strictEqual(seeded.title, FILE_CREATE_SCENARIO.titleSeed);
          assert.strictEqual(seeded.titleRegeneration?.requestId, MESSAGE_COMMAND);

          yield* harness.worker.drain;
          const titled = yield* threadOf(harness);
          assert.strictEqual(titled.title, "Hello file from Claude");
          assert.isNull(titled.titleRegeneration);
          assert.deepStrictEqual(text.requests, [
            {
              cwd: workspace,
              message: FILE_CREATE_SCENARIO.prompt,
              modelSelection: DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
            },
          ]);
        }).pipe(Effect.scoped),
    );

    it.effect("the title is generated beside the turn, which does not wait for it", () =>
      Effect.gen(function* () {
        const generating = yield* held("Hello file from Claude");
        const text = yield* scriptedTextGeneration([generating.step]);
        const harness = yield* makeHarness({ textGeneration: text.service });
        const { sent } = yield* sendFileCreateMessage(harness);

        const titleWorker = yield* Effect.forkScoped(harness.worker.drain);
        yield* Deferred.await(generating.started);
        // Another runner takes the turn while the title is still being written.
        yield* harness.worker.drain;
        const run = yield* harness.awaitRunEnded(threadId, sent.sequence);
        assert.strictEqual(run.status, "completed");
        assert.strictEqual((yield* threadOf(harness)).title, FILE_CREATE_SCENARIO.titleSeed);

        yield* Deferred.succeed(generating.release, undefined);
        yield* Fiber.join(titleWorker);
        assert.strictEqual((yield* threadOf(harness)).title, "Hello file from Claude");
      }).pipe(Effect.scoped),
    );

    it.effect("a rename while the title is being generated keeps the person's title", () =>
      Effect.gen(function* () {
        const generating = yield* held("Generated title");
        const text = yield* scriptedTextGeneration([generating.step]);
        const harness = yield* makeHarness({ textGeneration: text.service });
        yield* sendFileCreateMessage(harness);

        const worker = yield* Effect.forkScoped(harness.worker.drain);
        yield* Deferred.await(generating.started);
        yield* harness.orchestrator.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make("command:rename"),
          threadId,
          title: "My own title",
        });
        assert.isNull((yield* threadOf(harness)).titleRegeneration);
        yield* Deferred.succeed(generating.release, undefined);
        yield* Fiber.join(worker);

        const thread = yield* threadOf(harness);
        assert.strictEqual(thread.title, "My own title");
        assert.isNull(thread.titleRegeneration);
      }).pipe(Effect.scoped),
    );

    it.effect(
      "Regenerate title writes a new title from the conversation, and a failed one is not retried",
      () =>
        Effect.gen(function* () {
          const text = yield* scriptedTextGeneration([
            title("Hello file"),
            title("Write the hello file"),
            failure,
          ]);
          const harness = yield* makeHarness({ textGeneration: text.service });
          const { run } = yield* runFileCreateScenario(harness);
          assert.strictEqual(run.status, "completed");
          assert.strictEqual((yield* threadOf(harness)).title, "Hello file");

          yield* regenerate(harness, "command:regenerate");
          assert.strictEqual(
            (yield* threadOf(harness)).titleRegeneration?.requestId,
            "command:regenerate",
          );
          yield* harness.worker.drain;
          const regenerated = yield* threadOf(harness);
          assert.strictEqual(regenerated.title, "Write the hello file");
          assert.isNull(regenerated.titleRegeneration);
          const asked = text.requests[1]!;
          assert.strictEqual(asked.previousTitle, "Hello file");
          assert.isTrue(
            asked.message.startsWith(`USER:\n${FILE_CREATE_SCENARIO.prompt}\n\nASSISTANT:\n`),
          );

          yield* regenerate(harness, "command:regenerate-again");
          yield* harness.worker.drain;
          const kept = yield* threadOf(harness);
          assert.strictEqual(kept.title, "Write the hello file");
          assert.isNull(kept.titleRegeneration);
          assert.lengthOf(text.requests, 3);
        }).pipe(Effect.scoped),
    );

    it.effect("a regenerate that gives back the same title, or none, keeps the title", () =>
      Effect.gen(function* () {
        const text = yield* scriptedTextGeneration([
          title("Hello file"),
          title("Hello file"),
          title("New thread"),
        ]);
        const harness = yield* makeHarness({ textGeneration: text.service });
        yield* runFileCreateScenario(harness);
        const before = yield* threadOf(harness);

        yield* regenerate(harness, "command:regenerate-same");
        yield* harness.worker.drain;
        yield* regenerate(harness, "command:regenerate-none");
        yield* harness.worker.drain;

        const after = yield* threadOf(harness);
        assert.strictEqual(after.title, "Hello file");
        assert.isNull(after.titleRegeneration);
        assert.lengthOf(text.requests, 3);
        assert.strictEqual(before.title, "Hello file");
      }).pipe(Effect.scoped),
    );

    it.effect("a first title is tried twice more after failures, waiting between tries", () =>
      Effect.gen(function* () {
        const text = yield* scriptedTextGeneration([failure, failure, title("Third time lucky")]);
        const harness = yield* makeHarness({ textGeneration: text.service });
        yield* sendFileCreateMessage(harness);

        const worker = yield* Effect.forkScoped(harness.worker.drain);
        yield* Queue.take(text.asked);
        yield* nextRequestAfterWaiting(text.asked);
        yield* nextRequestAfterWaiting(text.asked);
        yield* Fiber.join(worker);

        assert.strictEqual((yield* threadOf(harness)).title, "Third time lucky");
        assert.lengthOf(text.requests, 3);
      }).pipe(Effect.scoped),
    );

    it.effect("a first title that fails three times keeps the seed", () =>
      Effect.gen(function* () {
        const text = yield* scriptedTextGeneration([failure, failure, failure]);
        const harness = yield* makeHarness({ textGeneration: text.service });
        yield* sendFileCreateMessage(harness);

        const worker = yield* Effect.forkScoped(harness.worker.drain);
        yield* Queue.take(text.asked);
        yield* nextRequestAfterWaiting(text.asked);
        yield* nextRequestAfterWaiting(text.asked);
        yield* Fiber.join(worker);

        const thread = yield* threadOf(harness);
        assert.strictEqual(thread.title, FILE_CREATE_SCENARIO.titleSeed);
        assert.isNull(thread.titleRegeneration);
        assert.lengthOf(text.requests, 3);
      }).pipe(Effect.scoped),
    );

    it.effect("archiving or deleting a thread drops the title being generated", () =>
      Effect.gen(function* () {
        const generating = yield* held("Too late");
        const text = yield* scriptedTextGeneration([generating.step]);
        const harness = yield* makeHarness({ textGeneration: text.service });
        yield* sendFileCreateMessage(harness);

        const worker = yield* Effect.forkScoped(harness.worker.drain);
        yield* Deferred.await(generating.started);
        yield* harness.orchestrator.dispatch({
          type: "thread.archive",
          commandId: CommandId.make("command:archive"),
          threadId,
        });
        assert.isNull((yield* threadOf(harness)).titleRegeneration);
        yield* Deferred.succeed(generating.release, undefined);
        yield* Fiber.join(worker);
        assert.strictEqual((yield* threadOf(harness)).title, FILE_CREATE_SCENARIO.titleSeed);

        yield* harness.orchestrator.dispatch({
          type: "thread.unarchive",
          commandId: CommandId.make("command:unarchive"),
          threadId,
        });
        yield* regenerate(harness, "command:regenerate");
        yield* harness.orchestrator.dispatch({
          type: "thread.delete",
          commandId: CommandId.make("command:delete"),
          threadId,
        });
        const deleted = yield* threadOf(harness);
        assert.isNotNull(deleted.deletedAt);
        assert.isNull(deleted.titleRegeneration);
        // The regenerate's effect finds its request gone and asks nothing.
        yield* harness.worker.drain;
        assert.lengthOf(text.requests, 1);
      }).pipe(Effect.scoped),
    );

    it.effect(
      "a title the server was generating when it stopped is generated after a restart",
      () =>
        Effect.gen(function* () {
          const config = yield* makeTestServerConfig();
          const generating = yield* held("Never delivered");
          const first = yield* makeHarness({
            textGeneration: (yield* scriptedTextGeneration([generating.step])).service,
            config,
          });
          yield* sendFileCreateMessage(first);
          // The first server is left generating, as a killed one would be.
          yield* Effect.forkScoped(first.worker.drain);
          yield* Deferred.await(generating.started);

          const text = yield* scriptedTextGeneration([title("Hello file after restart")]);
          const restarted = yield* makeHarness({
            textGeneration: text.service,
            config,
            recoverOnStartup: true,
          });
          yield* restarted.worker.drain;

          const thread = yield* threadOf(restarted);
          assert.strictEqual(thread.title, "Hello file after restart");
          assert.isNull(thread.titleRegeneration);
          assert.lengthOf(text.requests, 1);
        }).pipe(Effect.scoped),
    );
  });
});

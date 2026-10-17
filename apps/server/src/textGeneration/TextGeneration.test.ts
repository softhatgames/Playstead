import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import type {
  ProviderTextGeneration,
  ThreadTitleGenerationInput,
} from "@playstead/provider-core/server/textGeneration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as TextGeneration from "./TextGeneration.ts";
import { TextGenerationError } from "@playstead/provider-core/server/textGeneration";
import { replayClaude } from "../orchestration-v2/testkit/ProviderReplay.ts";
import {
  sendFileCreateMessage,
  FILE_CREATE_IDS,
} from "../orchestration-v2/testkit/fixtures/fileCreate.ts";
import { threadOf } from "../orchestration-v2/testkit/ThreadCommands.ts";

/**
 * Text generation goes to the instance the model selection names (T3 Code's
 * `TextGeneration.test.ts` at 2577baf), over a registry holding stand-in
 * instances.
 */

const recordingInstance = (
  name: string,
  calls: Array<{ readonly instance: string; readonly input: ThreadTitleGenerationInput }>,
): ProviderTextGeneration => ({
  generateThreadTitle: (input) =>
    Effect.sync(() => {
      calls.push({ instance: name, input });
      return { title: `${name} title` };
    }),
});

const makeTextGeneration = (
  instances: Partial<Record<ProviderInstanceId, ProviderTextGeneration>>,
) =>
  TextGeneration.make.pipe(
    Effect.provideService(ProviderRegistry.ProviderRegistry, {
      getProviders: Effect.succeed(
        (["codex", "claudeAgent"] as const).map((instanceId) => ({
          instanceId,
          driver: instanceId,
          displayName: instanceId,
          installed: instances[instanceId] !== undefined,
          version: null,
          status: "ready" as const,
          auth: { status: "unknown" as const },
          checkedAt: "",
          models: [],
        })),
      ),
      refresh: () =>
        Effect.succeed(
          (["codex", "claudeAgent"] as const).map((instanceId) => ({
            instanceId,
            driver: instanceId,
            displayName: instanceId,
            installed: instances[instanceId] !== undefined,
            version: null,
            status: "ready" as const,
            auth: { status: "unknown" as const },
            checkedAt: "",
            models: [],
          })),
        ),
      streamChanges: Effect.die("unused") as never,
      getAdapter: () => Effect.succeedNone,
      getTextGeneration: (instanceId) =>
        Effect.succeed(Option.fromUndefinedOr(instances[instanceId])),
    }),
  );

describe("TextGeneration", () => {
  it.effect("uses Claude's cheap model when the saved Codex provider is unavailable", () =>
    Effect.gen(function* () {
      const calls: Array<{
        readonly instance: string;
        readonly input: ThreadTitleGenerationInput;
      }> = [];
      const generation = yield* makeTextGeneration({
        claudeAgent: recordingInstance("claude", calls),
      });
      const result = yield* generation.generateThreadTitle({
        cwd: "/games/moon",
        message: "Name it",
        modelSelection: { instanceId: "codex", model: "gpt-6-luna" },
      });
      assert.strictEqual(result.title, "claude title");
      assert.deepStrictEqual(calls[0]?.input.modelSelection, {
        instanceId: "claudeAgent",
        model: "claude-haiku-5-5",
      });
    }),
  );
  it.effect("gives a title request to the instance its model selection names", () =>
    Effect.gen(function* () {
      const calls: Array<{
        readonly instance: string;
        readonly input: ThreadTitleGenerationInput;
      }> = [];
      const textGeneration = yield* makeTextGeneration({
        codex: recordingInstance("codex", calls),
        claudeAgent: recordingInstance("claude", calls),
      });
      const input = {
        cwd: "/games/moon",
        message: "Make the player jump higher",
        modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
      } as const;

      const generated = yield* textGeneration.generateThreadTitle(input);

      assert.deepStrictEqual(generated, { title: "claude title" });
      assert.deepStrictEqual(calls, [{ instance: "claude", input }]);
    }),
  );

  it.effect("fails when no instance has that id", () =>
    Effect.gen(function* () {
      const textGeneration = yield* makeTextGeneration({});
      const error = yield* Effect.flip(
        textGeneration.generateThreadTitle({
          cwd: "/games/moon",
          message: "Name it",
          modelSelection: { instanceId: "codex", model: "gpt-6-luna" },
        }),
      );
      assert.strictEqual(error.detail, "No provider instance registered for id 'codex'.");
    }),
  );
});

it.effect("does not fallback after an installed provider's generation fails", () =>
  Effect.gen(function* () {
    const calls: Array<{ readonly instance: string; readonly input: ThreadTitleGenerationInput }> =
      [];
    const generation = yield* makeTextGeneration({
      codex: {
        generateThreadTitle: () =>
          Effect.fail(
            new TextGenerationError({ operation: "generateThreadTitle", detail: "failed request" }),
          ),
      },
      claudeAgent: recordingInstance("claude", calls),
    });
    const error = yield* Effect.flip(
      generation.generateThreadTitle({
        cwd: "/games/moon",
        message: "Name it",
        modelSelection: { instanceId: "codex", model: "gpt-6-luna" },
      }),
    );
    assert.strictEqual(error.detail, "failed request");
    assert.deepStrictEqual(calls, []);
  }),
);

it.layer(NodeServices.layer)((it) => {
  it.effect(
    "persists a generated title with the default provider unavailable, without opening Settings",
    () =>
      Effect.gen(function* () {
        const calls: Array<{
          readonly instance: string;
          readonly input: ThreadTitleGenerationInput;
        }> = [];
        const textGeneration = yield* makeTextGeneration({
          claudeAgent: recordingInstance("claude", calls),
        });
        const { harness } = yield* replayClaude("file_create.claude.ndjson", {
          harness: { textGeneration },
        });
        yield* sendFileCreateMessage(harness);
        yield* harness.worker.drain;
        assert.strictEqual(
          (yield* threadOf(harness, FILE_CREATE_IDS.threadId)).title,
          "claude title",
        );
        assert.strictEqual(calls[0]?.input.modelSelection.instanceId, "claudeAgent");
      }).pipe(Effect.scoped),
  );
});

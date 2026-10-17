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
      getProviders: Effect.succeed([]),
      refresh: () => Effect.succeed([]),
      streamChanges: Effect.die("unused") as never,
      getAdapter: () => Effect.succeedNone,
      getTextGeneration: (instanceId) =>
        Effect.succeed(Option.fromUndefinedOr(instances[instanceId])),
    }),
  );

describe("TextGeneration", () => {
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

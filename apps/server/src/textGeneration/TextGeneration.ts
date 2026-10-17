import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import { DEFAULT_TEXT_GENERATION_MODELS } from "@playstead/contracts/settings";
import type { ServerProviders } from "@playstead/contracts/server";
import {
  type ProviderTextGeneration,
  TextGenerationError,
} from "@playstead/provider-core/server/textGeneration";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";

/** A missing CLI falls back in T3 Code's Codex-then-Claude order; no fallback after a request fails. */
export function resolveTextGenerationModelSelection(
  selection: ModelSelection | undefined,
  providers: ServerProviders,
): ModelSelection {
  const selected = selection ?? DEFAULT_TEXT_GENERATION_MODELS.codex;
  if (providers.some((p) => p.instanceId === selected.instanceId && p.installed)) return selected;
  const fallback = (["codex", "claudeAgent"] as const).find((id) =>
    providers.some((p) => p.instanceId === id && p.installed),
  );
  return fallback ? DEFAULT_TEXT_GENERATION_MODELS[fallback] : selected;
}

export class TextGeneration extends Context.Service<TextGeneration, ProviderTextGeneration>()(
  "@playstead/server/textGeneration/TextGeneration",
) {}
export const layer = Layer.effect(
  TextGeneration,
  Effect.gen(function* () {
    const registry = yield* ProviderRegistry;
    return TextGeneration.of({
      generateThreadTitle: Effect.fn("TextGeneration.generateThreadTitle")(function* (input) {
        const generator = yield* registry.getTextGeneration(input.modelSelection.instanceId);
        if (Option.isNone(generator))
          return yield* new TextGenerationError({
            detail: `Provider ${input.modelSelection.instanceId} does not support text generation.`,
          });
        return yield* generator.value.generateThreadTitle(input);
      }),
    });
  }),
);

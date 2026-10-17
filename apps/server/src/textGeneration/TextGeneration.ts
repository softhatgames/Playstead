import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import type { ServerProviders } from "@playstead/contracts/server";
import {
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
} from "@playstead/contracts/settings";
import {
  type ProviderTextGeneration,
  TextGenerationError,
} from "@playstead/provider-core/server/textGeneration";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";

/**
 * Text generation for the server, following T3 Code's
 * `apps/server/src/textGeneration/TextGeneration.ts` at 2577baf: each
 * request goes to the text generation of the provider instance its model
 * selection names, as that instance is now. T3 Code's linked source control
 * context for titles is absent.
 */
export class TextGeneration extends Context.Service<TextGeneration, ProviderTextGeneration>()(
  "@playstead/server/textGeneration/TextGeneration",
) {}

/** Resolve availability before starting; a failed generation is never retried on another provider. */
export function resolveTextGenerationModelSelection(
  selection: ModelSelection,
  providers: ServerProviders,
): ModelSelection {
  if (
    providers.some((provider) => provider.instanceId === selection.instanceId && provider.installed)
  )
    return selection;
  const fallback = (["codex", "claudeAgent"] as const).find((id) =>
    providers.some((provider) => provider.instanceId === id && provider.installed),
  );
  if (fallback === undefined) return selection;
  return fallback === "codex"
    ? DEFAULT_TEXT_GENERATION_MODEL_SELECTION
    : { instanceId: fallback, model: DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[fallback] };
}

export const make = Effect.gen(function* () {
  const registry = yield* ProviderRegistry.ProviderRegistry;
  return TextGeneration.of({
    generateThreadTitle: Effect.fn("TextGeneration.generateThreadTitle")(function* (input) {
      let providers = yield* registry.getProviders;
      // A newly configured instance initially reports unavailable while its
      // probe runs. Finish that check before choosing another provider.
      if (
        !providers.some(
          (provider) =>
            provider.instanceId === input.modelSelection.instanceId && provider.installed,
        )
      ) {
        providers = yield* registry.refresh();
      }
      const modelSelection = resolveTextGenerationModelSelection(input.modelSelection, providers);
      const generator = yield* registry.getTextGeneration(modelSelection.instanceId);
      if (Option.isNone(generator))
        return yield* new TextGenerationError({
          operation: "generateThreadTitle",
          detail: `No provider instance registered for id '${modelSelection.instanceId}'.`,
        });
      return yield* generator.value.generateThreadTitle({ ...input, modelSelection });
    }),
  });
});

export const layer = Layer.effect(TextGeneration, make);

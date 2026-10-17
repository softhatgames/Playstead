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

export const make = Effect.gen(function* () {
  const registry = yield* ProviderRegistry.ProviderRegistry;
  return TextGeneration.of({
    generateThreadTitle: (input) =>
      registry.getTextGeneration(input.modelSelection.instanceId).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({
                  operation: "generateThreadTitle",
                  detail: `No provider instance registered for id '${input.modelSelection.instanceId}'.`,
                }),
              ),
            onSome: (textGeneration) => textGeneration.generateThreadTitle(input),
          }),
        ),
      ),
  });
});

export const layer = Layer.effect(TextGeneration, make);

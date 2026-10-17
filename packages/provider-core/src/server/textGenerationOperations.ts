import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";

import type { ProviderTextGeneration, TextGenerationError } from "./textGeneration.ts";
import { buildThreadTitlePrompt } from "./textGenerationPrompts.ts";
import { sanitizeThreadTitle } from "./textGenerationUtils.ts";

/**
 * Text generation built on a provider's runner, as T3 Code's
 * `textGenerationOperations.ts` `fromRunner` at 2577baf: each operation
 * builds its prompt, the runner asks the provider for JSON matching the
 * schema, and the answer is cleaned up. Only the thread title is here.
 */

export type Operation = keyof ProviderTextGeneration;

export interface Request<S extends Schema.Top> {
  readonly operation: Operation;
  readonly cwd: string;
  readonly prompt: string;
  readonly outputSchema: S;
  readonly modelSelection: ModelSelection;
}

export type Runner = <S extends Schema.Top>(
  request: Request<S>,
) => Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]>;

export function fromRunner(name: string, run: Runner): ProviderTextGeneration {
  const generateThreadTitle: ProviderTextGeneration["generateThreadTitle"] = Effect.fn(
    `${name}.generateThreadTitle`,
  )(function* (input) {
    const generated = yield* run({
      operation: "generateThreadTitle",
      cwd: input.cwd,
      modelSelection: input.modelSelection,
      ...buildThreadTitlePrompt({ message: input.message, previousTitle: input.previousTitle }),
    });
    return {
      title: sanitizeThreadTitle(generated.title),
      ...(generated.needsRefinement ? { needsRefinement: true } : {}),
    };
  });
  return { generateThreadTitle };
}

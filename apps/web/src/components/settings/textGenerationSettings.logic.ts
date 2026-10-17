import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import type { ServerProvider } from "@playstead/contracts/server";
import { DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER } from "@playstead/contracts/settings";

import { deriveModelPickerEntries } from "../chat/composer.logic.ts";

/**
 * The provider and model **Text generation** stands on (T3 Code's
 * `resolveAppModelSelectionState`, `apps/web/src/modelSelection.ts` at
 * 2577baf): the chosen one while its provider is installed and lists the
 * model; else the first installed provider, Codex before Claude, with its
 * cheap text generation model, or its default model when it does not list
 * that. With no provider installed the setting shows as it is.
 */
export function resolveTextGenerationSelection(
  selection: ModelSelection,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection {
  const entries = deriveModelPickerEntries(providers, undefined);
  const selected = entries.find((entry) => entry.instanceId === selection.instanceId);
  if (selected?.models.some((model) => model.slug === selection.model)) return selection;
  const entry = selected ?? entries[0];
  if (entry === undefined) return selection;
  const cheap = DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[entry.instanceId];
  const model =
    entry.models.find((candidate) => candidate.slug === cheap) ??
    entry.models.find((candidate) => candidate.isDefault) ??
    entry.models[0];
  return model === undefined ? selection : { instanceId: entry.instanceId, model: model.slug };
}

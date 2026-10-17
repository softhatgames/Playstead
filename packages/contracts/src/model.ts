import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * A model's options and the person's choices among them, as T3 Code's
 * `packages/contracts/src/model.ts` at 2577baf has them. A provider describes
 * each model's options (reasoning effort, service tier, fast mode, …) as
 * descriptors; the picker shows them, and a `ModelSelection` carries what
 * was chosen as a list of `{id, value}`. T3 Code also decodes the older
 * object form of the choices; Playstead never stored that form, so it is
 * absent.
 */

const ProviderOptionSelection = Schema.Struct({
  id: TrimmedNonEmptyString,
  value: Schema.Union([TrimmedNonEmptyString, Schema.Boolean]),
});
export type ProviderOptionSelection = typeof ProviderOptionSelection.Type;

export const ProviderOptionSelections = Schema.Array(ProviderOptionSelection);
export type ProviderOptionSelections = typeof ProviderOptionSelections.Type;

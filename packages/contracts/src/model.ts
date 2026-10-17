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

export const ProviderOptionChoice = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optionalKey(TrimmedNonEmptyString),
  isDefault: Schema.optionalKey(Schema.Boolean),
});
export type ProviderOptionChoice = typeof ProviderOptionChoice.Type;

const ProviderOptionDescriptorBase = {
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optionalKey(TrimmedNonEmptyString),
} as const;

/** One choice among several; `promptInjectedValues` are chosen by writing them in the prompt (Ultrathink). */
const SelectProviderOptionDescriptor = Schema.Struct({
  ...ProviderOptionDescriptorBase,
  type: Schema.Literal("select"),
  options: Schema.Array(ProviderOptionChoice),
  currentValue: Schema.optionalKey(TrimmedNonEmptyString),
  promptInjectedValues: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
});

const BooleanProviderOptionDescriptor = Schema.Struct({
  ...ProviderOptionDescriptorBase,
  type: Schema.Literal("boolean"),
  currentValue: Schema.optionalKey(Schema.Boolean),
});

export const ProviderOptionDescriptor = Schema.Union([
  SelectProviderOptionDescriptor,
  BooleanProviderOptionDescriptor,
]);
export type ProviderOptionDescriptor = typeof ProviderOptionDescriptor.Type;

export const ProviderOptionSelection = Schema.Struct({
  id: TrimmedNonEmptyString,
  value: Schema.Union([TrimmedNonEmptyString, Schema.Boolean]),
});
export type ProviderOptionSelection = typeof ProviderOptionSelection.Type;

export const ProviderOptionSelections = Schema.Array(ProviderOptionSelection);
export type ProviderOptionSelections = typeof ProviderOptionSelections.Type;

/** What a model offers (T3 Code's `ModelCapabilities`). */
export const ModelCapabilities = Schema.Struct({
  optionDescriptors: Schema.optionalKey(Schema.Array(ProviderOptionDescriptor)),
});
export type ModelCapabilities = typeof ModelCapabilities.Type;

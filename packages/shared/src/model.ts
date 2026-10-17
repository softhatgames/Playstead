/**
 * Reading a model's option descriptors and the person's choices, after T3
 * Code's `packages/shared/src/model.ts` at 2577baf. The server compiles the
 * choices into what each provider takes; the composer's traits picker shows
 * the descriptors and builds the choices it sends.
 *
 * The types are written here by shape, matching
 * `@playstead/contracts/model`, because the contracts package depends on
 * this one. T3 Code's reported-selection and OpenCode `variant` rules are
 * absent, as those providers are.
 */

export interface OptionSelection {
  readonly id: string;
  readonly value: string | boolean;
}

interface SelectionWithOptions {
  readonly instanceId: string;
  readonly model: string;
  readonly options?: ReadonlyArray<OptionSelection>;
}

const selectionValue = (
  selections: ReadonlyArray<OptionSelection> | null | undefined,
  id: string,
): string | boolean | undefined => selections?.find((selection) => selection.id === id)?.value;

export function getModelSelectionStringOptionValue(
  modelSelection: SelectionWithOptions | null | undefined,
  id: string,
): string | undefined {
  const value = selectionValue(modelSelection?.options, id);
  return typeof value === "string" ? value : undefined;
}

export function getModelSelectionBooleanOptionValue(
  modelSelection: SelectionWithOptions | null | undefined,
  id: string,
): boolean | undefined {
  const value = selectionValue(modelSelection?.options, id);
  return typeof value === "boolean" ? value : undefined;
}

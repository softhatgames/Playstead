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

export interface OptionChoice {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly isDefault?: boolean;
}

export type OptionDescriptor =
  | {
      readonly id: string;
      readonly label: string;
      readonly description?: string;
      readonly type: "select";
      readonly options: ReadonlyArray<OptionChoice>;
      readonly currentValue?: string;
      readonly promptInjectedValues?: ReadonlyArray<string>;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly description?: string;
      readonly type: "boolean";
      readonly currentValue?: boolean;
    };

export type SelectOptionDescriptor = Extract<OptionDescriptor, { type: "select" }>;

export interface OptionSelection {
  readonly id: string;
  readonly value: string | boolean;
}

export interface Capabilities {
  readonly optionDescriptors?: ReadonlyArray<OptionDescriptor>;
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

const sortedOptions = (selection: SelectionWithOptions) =>
  (selection.options ?? [])
    .map(({ id, value }) => `${id}=${String(value)}:${typeof value}`)
    .toSorted();

/** Same instance, model and choices, in any order (T3 Code's `modelSelectionsEqual`). */
export function modelSelectionsEqual(
  left: SelectionWithOptions,
  right: SelectionWithOptions,
): boolean {
  if (left.instanceId !== right.instanceId || left.model !== right.model) return false;
  const leftOptions = sortedOptions(left);
  const rightOptions = sortedOptions(right);
  return (
    leftOptions.length === rightOptions.length &&
    leftOptions.every((option, index) => option === rightOptions[index])
  );
}

const defaultChoice = (descriptor: SelectOptionDescriptor) =>
  descriptor.options.find((option) => option.isDefault)?.id;

/**
 * The choice a select stands on (T3 Code's `resolveDescriptorChoiceValue`):
 * a known choice, else the descriptor's current value or its default. A
 * prompt-injected choice (Ultrathink) is never stored, so it reads as the
 * default.
 */
function resolveChoice(descriptor: SelectOptionDescriptor, raw: string | undefined) {
  const trimmed = raw?.trim();
  if (!trimmed) return descriptor.currentValue ?? defaultChoice(descriptor);
  if (descriptor.options.length === 0) return trimmed;
  const known = descriptor.options.some((option) => option.id === trimmed);
  if (known && descriptor.promptInjectedValues?.includes(trimmed)) return defaultChoice(descriptor);
  if (known) return trimmed;
  return descriptor.currentValue ?? defaultChoice(descriptor);
}

/**
 * A model's descriptors with each one's current value set from the
 * choices, where they name it (T3 Code's `getProviderOptionDescriptors`).
 */
export function getProviderOptionDescriptors(input: {
  readonly caps: Capabilities;
  readonly selections?: ReadonlyArray<OptionSelection> | null | undefined;
}): ReadonlyArray<OptionDescriptor> {
  return (input.caps.optionDescriptors ?? []).map((descriptor): OptionDescriptor => {
    const raw = selectionValue(input.selections, descriptor.id) ?? descriptor.currentValue;
    if (descriptor.type === "boolean") {
      return typeof raw === "boolean" ? { ...descriptor, currentValue: raw } : { ...descriptor };
    }
    const { currentValue: _previous, ...rest } = descriptor;
    const currentValue = resolveChoice(
      descriptor,
      typeof raw === "string" ? raw : descriptor.currentValue,
    );
    return currentValue === undefined ? rest : { ...rest, currentValue };
  });
}

/** What a descriptor stands on: its current value, or a select's default choice. */
export function getProviderOptionCurrentValue(
  descriptor: OptionDescriptor | null | undefined,
): string | boolean | undefined {
  if (!descriptor) return undefined;
  if (descriptor.type === "boolean") return descriptor.currentValue;
  return descriptor.currentValue || defaultChoice(descriptor);
}

/** How the current value reads: a choice's label, or On and Off. */
export function getProviderOptionCurrentLabel(
  descriptor: OptionDescriptor | null | undefined,
): string | undefined {
  if (!descriptor) return undefined;
  if (descriptor.type === "boolean") {
    return typeof descriptor.currentValue === "boolean"
      ? descriptor.currentValue
        ? "On"
        : "Off"
      : undefined;
  }
  const value = getProviderOptionCurrentValue(descriptor);
  return descriptor.options.find((option) => option.id === value)?.label;
}

/** Every descriptor's current value as a choice (T3 Code's `buildProviderOptionSelectionsFromDescriptors`). */
export function buildProviderOptionSelectionsFromDescriptors(
  descriptors: ReadonlyArray<OptionDescriptor> | null | undefined,
): Array<OptionSelection> | undefined {
  const selections = (descriptors ?? []).flatMap((descriptor) => {
    const value = getProviderOptionCurrentValue(descriptor);
    return value === undefined ? [] : [{ id: descriptor.id, value }];
  });
  return selections.length > 0 ? selections : undefined;
}

/**
 * Only the options the person chose, normalised against the descriptors, so
 * the rest stay the provider's own default (T3 Code's
 * `buildExplicitProviderOptionSelectionsFromDescriptors`).
 */
export function buildExplicitProviderOptionSelectionsFromDescriptors(
  descriptors: ReadonlyArray<OptionDescriptor> | null | undefined,
  selections: ReadonlyArray<OptionSelection> | null | undefined,
): Array<OptionSelection> | undefined {
  if (!selections || selections.length === 0) return undefined;
  const chosen = new Set(selections.map((selection) => selection.id));
  const explicit = buildProviderOptionSelectionsFromDescriptors(descriptors)?.filter((selection) =>
    chosen.has(selection.id),
  );
  return explicit && explicit.length > 0 ? explicit : undefined;
}

export function isClaudeUltrathinkPrompt(text: string | null | undefined): boolean {
  return typeof text === "string" && /\bultrathink\b/i.test(text);
}

/** The raw effort, when it is one a descriptor offers by prompt (Ultrathink). */
export function resolvePromptInjectedEffort(
  caps: Capabilities,
  rawEffort: string | null | undefined,
): string | undefined {
  const trimmed = rawEffort?.trim();
  if (!trimmed) return undefined;
  return getProviderOptionDescriptors({ caps }).some(
    (descriptor) =>
      descriptor.type === "select" && descriptor.promptInjectedValues?.includes(trimmed),
  )
    ? trimmed
    : undefined;
}

/**
 * The prompt with T3 Code's `Ultrathink:` prefix when the effort is
 * Ultrathink (`applyClaudePromptEffortPrefix`). A slash command keeps its
 * text, since the prefix would turn it into prose; a path such as
 * `/home/me/app.ts` does not count as one.
 */
export function applyClaudePromptEffortPrefix(
  text: string,
  effort: string | null | undefined,
): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (effort !== "ultrathink" || /^\/[^\s/]+(?:\s|$)/u.test(trimmed)) return trimmed;
  if (trimmed.startsWith("Ultrathink:")) return trimmed;
  return `Ultrathink:\n${trimmed}`;
}

import type {
  ModelCapabilities,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
} from "@playstead/contracts/model";
import type { ProviderDriverKind } from "@playstead/contracts/providerInstance";
import {
  applyClaudePromptEffortPrefix,
  buildExplicitProviderOptionSelectionsFromDescriptors,
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isClaudeUltrathinkPrompt,
} from "@playstead/shared/model";

/**
 * The reasoning and traits picker's logic, after T3 Code's
 * `apps/web/src/components/chat/TraitsPicker.tsx` and
 * `composerProviderState.tsx` at 2577baf: a model's option descriptors
 * with the person's choices applied, what the trigger reads, what a pick
 * changes, and which choices a message carries. Options a model does not
 * describe (OpenCode's saved values, plan-mode agents) are absent.
 */

type Options = ReadonlyArray<ProviderOptionSelection>;
type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;
type BooleanDescriptor = Extract<ProviderOptionDescriptor, { type: "boolean" }>;

const ULTRATHINK_PROMPT_PREFIX = "Ultrathink:\n";
const EMPTY_CAPABILITIES: ModelCapabilities = { optionDescriptors: [] };

/**
 * Fast Mode counts as chosen only when the person chose it; otherwise it is
 * off (T3 Code's `withImplicitFastModeDefault`).
 */
const withImplicitFastModeDefault = (
  capabilities: ModelCapabilities,
  options: Options | undefined,
): Options | undefined => {
  if (options?.some((option) => option.id === "fastMode")) return options;
  const offersFastMode = capabilities.optionDescriptors?.some(
    (descriptor) => descriptor.type === "boolean" && descriptor.id === "fastMode",
  );
  return offersFastMode ? [...(options ?? []), { id: "fastMode", value: false }] : options;
};

export interface TraitsMenuState {
  readonly provider: ProviderDriverKind;
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly selectDescriptors: ReadonlyArray<SelectDescriptor>;
  readonly booleanDescriptors: ReadonlyArray<BooleanDescriptor>;
  /** The first select, the picker's main control (Reasoning). */
  readonly primarySelectDescriptor: SelectDescriptor | undefined;
  /** The prompt asks for Ultrathink, so the main control shows it. */
  readonly ultrathinkPromptControlled: boolean;
  /** The prompt's own words say ultrathink, so the main control cannot change. */
  readonly ultrathinkInBodyText: boolean;
  readonly hasAnyControls: boolean;
  readonly triggerLabel: string;
}

/**
 * The picker for a model, its choices and the prompt (T3 Code's
 * `getTraitsSectionVisibility`); a model without options shows none.
 */
export function traitsMenuState(input: {
  readonly provider: ProviderDriverKind;
  readonly capabilities: ModelCapabilities | null | undefined;
  readonly prompt: string;
  readonly options?: Options | undefined;
}): TraitsMenuState {
  const capabilities = input.capabilities ?? EMPTY_CAPABILITIES;
  const descriptors = getProviderOptionDescriptors({
    caps: capabilities,
    selections: withImplicitFastModeDefault(capabilities, input.options),
  });
  const selectDescriptors = descriptors.filter(
    (descriptor): descriptor is SelectDescriptor => descriptor.type === "select",
  );
  const booleanDescriptors = descriptors.filter(
    (descriptor): descriptor is BooleanDescriptor => descriptor.type === "boolean",
  );
  const primarySelectDescriptor = selectDescriptors[0];
  const ultrathinkPromptControlled =
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    isClaudeUltrathinkPrompt(input.prompt);
  const ultrathinkInBodyText =
    ultrathinkPromptControlled &&
    isClaudeUltrathinkPrompt(input.prompt.replace(/^Ultrathink:\s*/i, ""));
  return {
    provider: input.provider,
    descriptors,
    selectDescriptors,
    booleanDescriptors,
    primarySelectDescriptor,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
    hasAnyControls: descriptors.some(
      (descriptor) =>
        descriptor === primarySelectDescriptor ||
        ["fastMode", "thinking", "contextWindow"].includes(descriptor.id),
    ),
    triggerLabel: buildTraitsTriggerDisplay({
      provider: input.provider,
      descriptors,
      primarySelectDescriptorId: primarySelectDescriptor?.id ?? null,
      ultrathinkPromptControlled,
    }).label,
  };
}

/** The choice a select shows as picked. */
export function selectedChoice(state: TraitsMenuState, descriptor: SelectDescriptor) {
  if (state.ultrathinkPromptControlled && descriptor.id === state.primarySelectDescriptor?.id) {
    return "ultrathink";
  }
  const value = getProviderOptionCurrentValue(descriptor);
  return typeof value === "string" ? value : undefined;
}

const SPEED_TIER_LABELS = { fast: "Fast", ultrafast: "Ultrafast" } as const;
const REASONING_IDS: ReadonlySet<string> = new Set([
  "reasoningEffort",
  "reasoning",
  "effort",
  "variant",
  "thinking",
]);

/**
 * What the trigger reads (T3 Code's `buildTraitsTriggerDisplay`): each
 * option's current label joined with " · ", with Fast (Claude's Fast Mode,
 * or Codex's Fast and Ultrafast tiers) added to the reasoning label.
 */
export function buildTraitsTriggerDisplay(input: {
  readonly provider: ProviderDriverKind;
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly primarySelectDescriptorId: string | null;
  readonly ultrathinkPromptControlled: boolean;
}): { readonly label: string } {
  let speedLabel: string | null = null;
  let fallbackLabel: string | null = null;
  let reasoningIndex = -1;
  const labels: Array<string> = [];
  for (const descriptor of input.descriptors) {
    if (descriptor.id === "fastMode" && descriptor.type === "boolean") {
      speedLabel = descriptor.currentValue === true ? SPEED_TIER_LABELS.fast : null;
      fallbackLabel = speedLabel ?? "Normal";
      continue;
    }
    if (
      input.provider === "codex" &&
      descriptor.id === "serviceTier" &&
      descriptor.type === "select"
    ) {
      const current = getProviderOptionCurrentValue(descriptor);
      const fast = descriptor.options.find((option) => option.label === SPEED_TIER_LABELS.fast);
      const ultrafast = descriptor.options.find(
        (option) => option.label === SPEED_TIER_LABELS.ultrafast,
      );
      const isSpeedTier =
        ((fast !== undefined || ultrafast !== undefined) && current === "default") ||
        (fast !== undefined && current === fast.id) ||
        (ultrafast !== undefined && current === ultrafast.id);
      if (isSpeedTier) {
        speedLabel =
          ultrafast !== undefined && current === ultrafast.id
            ? SPEED_TIER_LABELS.ultrafast
            : fast !== undefined && current === fast.id
              ? SPEED_TIER_LABELS.fast
              : null;
        fallbackLabel =
          descriptor.options.find((option) => option.id === current)?.label ?? "Normal";
        continue;
      }
    }
    const label =
      input.ultrathinkPromptControlled && descriptor.id === input.primarySelectDescriptorId
        ? "Ultrathink"
        : descriptor.type === "boolean"
          ? `${descriptor.label} ${descriptor.currentValue === true ? "On" : "Off"}`
          : getProviderOptionCurrentLabel(descriptor);
    if (label === undefined || label.length === 0) continue;
    if (reasoningIndex === -1 && descriptor.type === "select" && REASONING_IDS.has(descriptor.id)) {
      reasoningIndex = labels.length;
    }
    labels.push(label);
  }
  if (labels.length === 0 && fallbackLabel !== null) return { label: fallbackLabel };
  if (speedLabel !== null) {
    if (reasoningIndex >= 0) labels[reasoningIndex] = `${labels[reasoningIndex]} ${speedLabel}`;
    else labels.push(speedLabel);
  }
  return { label: labels.join(" · ") };
}

/** What a pick changes: the prompt, the choices, both or neither. */
export interface TraitChange {
  readonly prompt?: string;
  readonly options?: Options | undefined;
}

const withValue = (
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  id: string,
  value: string | boolean,
): ReadonlyArray<ProviderOptionDescriptor> =>
  descriptors.map((descriptor) =>
    descriptor.id !== id
      ? descriptor
      : descriptor.type === "boolean"
        ? typeof value === "boolean"
          ? { ...descriptor, currentValue: value }
          : descriptor
        : typeof value === "string"
          ? { ...descriptor, currentValue: value }
          : descriptor,
  );

/**
 * A pick in the menu (T3 Code's `handleSelectChange` and boolean toggle):
 * Ultrathink is written into the prompt; any other pick chooses every
 * option as the menu stands, taking the Ultrathink prefix off when it
 * changes the main control. While the prompt's own words say ultrathink,
 * the main control does not change.
 */
export function chooseTrait(
  state: TraitsMenuState,
  descriptorId: string,
  value: string | boolean,
  prompt: string,
): TraitChange {
  const descriptor = state.descriptors.find((candidate) => candidate.id === descriptorId);
  if (descriptor === undefined) return {};
  const isPrimary = descriptorId === state.primarySelectDescriptor?.id;
  if (descriptor.type === "select") {
    if (typeof value !== "string" || value.length === 0) return {};
    if (descriptor.promptInjectedValues?.includes(value) === true) {
      return {
        prompt:
          prompt.trim().length === 0
            ? ULTRATHINK_PROMPT_PREFIX
            : applyClaudePromptEffortPrefix(prompt, "ultrathink"),
      };
    }
    if (state.ultrathinkInBodyText && isPrimary) return {};
  }
  const options = buildProviderOptionSelectionsFromDescriptors(
    withValue(state.descriptors, descriptorId, value),
  );
  return state.ultrathinkPromptControlled && isPrimary
    ? { prompt: prompt.replace(/^Ultrathink:\s*/i, ""), options }
    : { options };
}

/**
 * The choices a message carries: only those the person made, read against
 * the model's descriptors, so the rest stay the provider's own default (T3
 * Code's `getComposerProviderState` `modelOptionsForDispatch`).
 */
export function traitsForDispatch(
  capabilities: ModelCapabilities | null | undefined,
  options: Options | undefined,
): Options | undefined {
  const caps = capabilities ?? EMPTY_CAPABILITIES;
  const selections = withImplicitFastModeDefault(caps, options);
  return buildExplicitProviderOptionSelectionsFromDescriptors(
    getProviderOptionDescriptors({ caps, selections }),
    selections,
  );
}

/** Where remembered traits are kept: the page's `localStorage`, or a stand-in in tests. */
export interface TraitsStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

const TRAITS_STORAGE_KEY = "playstead:composer-traits:v1";

type Remembered = Record<string, Record<string, Options>>;

const isOptions = (value: unknown): value is Options =>
  Array.isArray(value) &&
  value.every(
    (option: unknown) =>
      typeof option === "object" &&
      option !== null &&
      typeof Reflect.get(option, "id") === "string" &&
      ["string", "boolean"].includes(typeof Reflect.get(option, "value")),
  );

/**
 * The traits remembered per provider instance and model for new threads
 * (T3 Code's `stickyOptionsByModelByProvider`, kept in `localStorage` as
 * T3 Code keeps its draft store's).
 */
export function makeTraitsMemory(storage: TraitsStorage) {
  const read = (): Remembered => {
    try {
      const parsed: unknown = JSON.parse(storage.getItem(TRAITS_STORAGE_KEY) ?? "{}");
      return typeof parsed === "object" && parsed !== null ? (parsed as Remembered) : {};
    } catch {
      return {};
    }
  };
  return {
    recall: (instanceId: string, model: string): Options | undefined => {
      const options: unknown = read()[instanceId]?.[model];
      return isOptions(options) && options.length > 0 ? options : undefined;
    },
    remember: (instanceId: string, model: string, options: Options | undefined) => {
      const remembered = read();
      const forInstance = { ...remembered[instanceId] };
      if (options === undefined || options.length === 0) delete forInstance[model];
      else forInstance[model] = options;
      storage.setItem(
        TRAITS_STORAGE_KEY,
        JSON.stringify({ ...remembered, [instanceId]: forInstance }),
      );
    },
  };
}

import type { ModelCapabilities, ProviderOptionChoice } from "@playstead/contracts/model";
import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import type { ServerProviderModel } from "@playstead/contracts/server";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  resolvePromptInjectedEffort,
} from "@playstead/shared/model";

import { compareVersions, parseStableVersion } from "./providerCompatibility.ts";

interface ClaudeCatalogModel {
  readonly model: ServerProviderModel;
  /** The oldest Claude Code that runs the model. */
  readonly minVersion: string;
  /**
   * How an effort choice reaches Claude Code (the profile's
   * `adapter.claudeCode.effortMap`): Ultracode runs as `xhigh`, and
   * Ultrathink sends no effort, since it is a prompt prefix.
   */
  readonly effortMap: Readonly<Record<string, string | null>>;
}

const choice = (id: string, label: string, extra: Partial<ProviderOptionChoice> = {}) => ({
  id,
  label,
  ...extra,
});

const ULTRACODE = choice("ultracode", "Ultracode", {
  description: "xhigh effort plus multi-agent workflow orchestration",
});

/** A profile's **Reasoning** select, with Ultrathink chosen by writing it in the prompt. */
const reasoning = (options: ReadonlyArray<ProviderOptionChoice>) =>
  ({
    id: "effort",
    label: "Reasoning",
    type: "select",
    options: [...options, choice("ultrathink", "Ultrathink")],
    promptInjectedValues: ["ultrathink"],
  }) as const;

const FAST_MODE = { id: "fastMode", label: "Fast Mode", type: "boolean" } as const;

/**
 * Claude's models, from T3 Code's bundled catalog at 2577baf
 * (`providers.claudeAgent` in `apps/server/src/provider/model-manifest.json`,
 * read by `ClaudeModelCatalog.ts` and `ClaudeModelManifest.ts`): the models
 * it marks current, its default chat model, each model's `minVersion`, and
 * the options of each model's profile (`opus-5-5`, `sonnet-5`, `fable-5`,
 * `haiku-5-5`). T3 Code also fetches that manifest from GitHub and lists
 * legacy models; Playstead keeps this list fixed and fetches nothing. The
 * list moves with the followed commit. None of these profiles offers
 * Thinking or a context-window choice (each runs a fixed 1M window), so
 * those options are absent.
 */
const CLAUDE_MODEL_CATALOG: ReadonlyArray<ClaudeCatalogModel> = [
  {
    model: {
      slug: "claude-opus-5-5",
      name: "Claude Opus 5.5",
      capabilities: {
        optionDescriptors: [
          reasoning([
            choice("low", "Low"),
            choice("medium", "Medium", { isDefault: true }),
            choice("high", "High"),
            choice("xhigh", "Extra High"),
            choice("max", "Max"),
            ULTRACODE,
          ]),
          FAST_MODE,
        ],
      },
    },
    minVersion: "2.1.280",
    effortMap: { ultracode: "xhigh", ultrathink: null },
  },
  {
    model: {
      slug: "claude-sonnet-5-5",
      name: "Claude Sonnet 5.5",
      capabilities: {
        optionDescriptors: [
          reasoning([
            choice("low", "Low"),
            choice("medium", "Medium"),
            choice("high", "High", { isDefault: true }),
            choice("xhigh", "Extra High"),
            choice("max", "Max"),
          ]),
        ],
      },
    },
    minVersion: "2.1.284",
    effortMap: { ultrathink: null },
  },
  {
    model: {
      slug: "claude-fable-5-1",
      name: "Claude Fable 5.1",
      isDefault: true,
      capabilities: {
        optionDescriptors: [
          reasoning([
            choice("low", "Low"),
            choice("medium", "Medium", { isDefault: true }),
            choice("high", "High"),
            choice("xhigh", "Extra High"),
            choice("max", "Max"),
            ULTRACODE,
          ]),
        ],
      },
    },
    minVersion: "2.1.257",
    effortMap: { ultracode: "xhigh", ultrathink: null },
  },
  {
    model: {
      slug: "claude-haiku-5-5",
      name: "Claude Haiku 5.5",
      capabilities: {
        optionDescriptors: [
          reasoning([
            choice("low", "Low"),
            choice("medium", "Medium", { isDefault: true }),
            choice("high", "High"),
            choice("xhigh", "Extra High"),
            choice("max", "Max"),
          ]),
        ],
      },
    },
    minVersion: "2.1.293",
    effortMap: { ultrathink: null },
  },
];

/**
 * The models a Claude Code version runs, as T3 Code's
 * `resolveClaudeModelsForVersion`: a model gated by a minimum version needs a
 * known version at least that new.
 */
export function resolveClaudeModelsForVersion(
  version: string | null,
): ReadonlyArray<ServerProviderModel> {
  const parsed = version === null ? undefined : parseStableVersion(version);
  return CLAUDE_MODEL_CATALOG.flatMap((entry) => {
    const minimum = parseStableVersion(entry.minVersion);
    return parsed !== undefined && minimum !== undefined && compareVersions(parsed, minimum) >= 0
      ? [entry.model]
      : [];
  });
}

/** What a selection becomes for Claude Code (T3 Code's `CompiledClaudeModelSelection`). */
export interface CompiledClaudeModelSelection {
  readonly apiModelId: string;
  /** The SDK's `effort`; none for Ultrathink. */
  readonly effort: string | undefined;
  /** Ultrathink, which goes in the prompt instead. */
  readonly promptEffort: string | undefined;
  /** Claude Code settings the selection turns on or off. */
  readonly settings: { readonly fastMode?: boolean; readonly ultracode?: true };
  /** Equal for two selections that run the same. */
  readonly queryIdentity: string;
}

const EMPTY_CAPABILITIES: ModelCapabilities = { optionDescriptors: [] };

/**
 * A model selection as Claude Code takes it, as T3 Code's
 * `compileClaudeModelSelection` (`apps/server/src/claudeModelOptions.ts`)
 * builds it: the effort chosen, or the model's default, through the
 * profile's effort map; Fast Mode, off unless chosen, on a model that
 * offers it; Ultracode as a setting; and Ultrathink as the prompt's effort.
 * A model outside the catalog runs as named, with no options.
 */
export function compileClaudeModelSelection(
  selection: ModelSelection,
): CompiledClaudeModelSelection {
  const entry = CLAUDE_MODEL_CATALOG.find((candidate) => candidate.model.slug === selection.model);
  const capabilities = entry?.model.capabilities ?? EMPTY_CAPABILITIES;
  const rawEffort = getModelSelectionStringOptionValue(selection, "effort");
  const effortDescriptor = getProviderOptionDescriptors({
    caps: capabilities,
    ...(rawEffort === undefined ? {} : { selections: [{ id: "effort", value: rawEffort }] }),
  }).find((descriptor) => descriptor.id === "effort");
  const resolved = getProviderOptionCurrentValue(effortDescriptor);
  const resolvedEffort = typeof resolved === "string" ? resolved : undefined;
  const effort =
    resolvedEffort !== undefined &&
    entry !== undefined &&
    Object.hasOwn(entry.effortMap, resolvedEffort)
      ? (entry.effortMap[resolvedEffort] ?? undefined)
      : resolvedEffort;
  const offersFastMode = (capabilities.optionDescriptors ?? []).some(
    (descriptor) => descriptor.type === "boolean" && descriptor.id === "fastMode",
  );
  const settings = {
    ...(offersFastMode
      ? { fastMode: getModelSelectionBooleanOptionValue(selection, "fastMode") ?? false }
      : {}),
    ...(resolvedEffort === "ultracode" ? { ultracode: true as const } : {}),
  };
  const apiModelId = entry?.model.slug ?? selection.model;
  return {
    apiModelId,
    effort,
    promptEffort: resolvePromptInjectedEffort(capabilities, rawEffort),
    settings,
    queryIdentity: JSON.stringify({ apiModelId, effort: effort ?? null, settings }),
  };
}

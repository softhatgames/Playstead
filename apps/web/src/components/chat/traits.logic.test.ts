import { assert, describe, it } from "@effect/vitest";
import type { ModelCapabilities, ProviderOptionDescriptor } from "@playstead/contracts/model";

import {
  buildTraitsTriggerDisplay,
  chooseTrait,
  makeTraitsMemory,
  traitsForDispatch,
  traitsMenuState,
} from "./traits.logic.ts";

/** Codex's options for a model, as `model/list` gives them (gpt-5.6-terra on codex 0.163.0). */
const CODEX_TERRA: ModelCapabilities = {
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
      currentValue: "medium",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        { id: "priority", label: "Fast", description: "1.5x speed, increased usage" },
      ],
      currentValue: "default",
    },
  ],
};

const claudeReasoning = (withUltracode: boolean): ProviderOptionDescriptor => ({
  id: "effort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
    ...(withUltracode ? [{ id: "ultracode", label: "Ultracode" }] : []),
    { id: "ultrathink", label: "Ultrathink" },
  ],
  promptInjectedValues: ["ultrathink"],
});

/** Claude Opus 5.5's options from T3 Code's catalog. */
const CLAUDE_OPUS: ModelCapabilities = {
  optionDescriptors: [
    claudeReasoning(true),
    { id: "fastMode", label: "Fast Mode", type: "boolean" },
  ],
};

/** Claude Haiku 5.5's: reasoning only. */
const CLAUDE_HAIKU: ModelCapabilities = { optionDescriptors: [claudeReasoning(false)] };

const label = (input: Parameters<typeof traitsMenuState>[0]) => traitsMenuState(input).triggerLabel;

describe("the traits picker's trigger", () => {
  it("names Codex's reasoning, and adds Fast only on the Fast tier", () => {
    assert.strictEqual(
      label({ provider: "codex", capabilities: CODEX_TERRA, prompt: "" }),
      "Medium",
    );
    assert.strictEqual(
      label({
        provider: "codex",
        capabilities: CODEX_TERRA,
        prompt: "",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "serviceTier", value: "priority" },
        ],
      }),
      "High Fast",
    );
  });

  it("adds Fast to Claude's reasoning only when Fast Mode is on", () => {
    assert.strictEqual(
      label({ provider: "claudeAgent", capabilities: CLAUDE_OPUS, prompt: "" }),
      "Medium",
    );
    assert.strictEqual(
      label({
        provider: "claudeAgent",
        capabilities: CLAUDE_OPUS,
        prompt: "",
        options: [{ id: "fastMode", value: true }],
      }),
      "Medium Fast",
    );
  });

  it("reads Ultrathink when the prompt asks for it", () => {
    assert.strictEqual(
      label({
        provider: "claudeAgent",
        capabilities: CLAUDE_HAIKU,
        prompt: "Ultrathink:\nPlan it",
      }),
      "Ultrathink",
    );
  });

  it("is absent for a model without options", () => {
    assert.isFalse(
      traitsMenuState({ provider: "codex", capabilities: { optionDescriptors: [] }, prompt: "" })
        .hasAnyControls,
    );
    assert.isFalse(
      traitsMenuState({ provider: "codex", capabilities: null, prompt: "" }).hasAnyControls,
    );
  });
});

describe("buildTraitsTriggerDisplay", () => {
  const effort: ProviderOptionDescriptor = {
    id: "reasoningEffort",
    label: "Reasoning",
    type: "select",
    options: [{ id: "high", label: "High" }],
    currentValue: "high",
  };
  const tier = (currentValue: string): ProviderOptionDescriptor => ({
    id: "serviceTier",
    label: "Service Tier",
    type: "select",
    options: [
      { id: "default", label: "Standard", isDefault: true },
      { id: "priority", label: "Fast" },
      { id: "ultrafast", label: "Ultrafast" },
      { id: "flex", label: "Flex" },
    ],
    currentValue,
  });
  const display = (descriptors: ReadonlyArray<ProviderOptionDescriptor>) =>
    buildTraitsTriggerDisplay({
      provider: "codex",
      descriptors,
      primarySelectDescriptorId: "reasoningEffort",
      ultrathinkPromptControlled: false,
    }).label;

  it("keeps Ultrafast distinct from Fast, and other tiers as text", () => {
    assert.strictEqual(display([effort, tier("ultrafast")]), "High Ultrafast");
    assert.strictEqual(display([effort, tier("flex")]), "High · Flex");
  });

  it("keeps the service tier readable when it is the only trait", () => {
    assert.strictEqual(display([tier("default")]), "Standard");
    assert.strictEqual(display([tier("priority")]), "Fast");
  });

  it("falls back to Fast or Normal when fast mode is the only trait", () => {
    const fastMode = (currentValue: boolean): ProviderOptionDescriptor => ({
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
      currentValue,
    });
    assert.strictEqual(display([fastMode(true)]), "Fast");
    assert.strictEqual(display([fastMode(false)]), "Normal");
  });
});

describe("choosing a trait", () => {
  it("chooses every option at once, as the menu's choices stand", () => {
    const state = traitsMenuState({ provider: "codex", capabilities: CODEX_TERRA, prompt: "" });
    assert.deepStrictEqual(chooseTrait(state, "reasoningEffort", "high", ""), {
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "serviceTier", value: "default" },
      ],
    });
  });

  it("turns Fast Mode on and off", () => {
    const state = traitsMenuState({
      provider: "claudeAgent",
      capabilities: CLAUDE_OPUS,
      prompt: "",
    });
    assert.deepStrictEqual(chooseTrait(state, "fastMode", true, ""), {
      options: [
        { id: "effort", value: "medium" },
        { id: "fastMode", value: true },
      ],
    });
  });

  it("writes Ultrathink into the prompt instead of the options", () => {
    const state = traitsMenuState({
      provider: "claudeAgent",
      capabilities: CLAUDE_HAIKU,
      prompt: "Plan the level",
    });
    assert.deepStrictEqual(chooseTrait(state, "effort", "ultrathink", "Plan the level"), {
      prompt: "Ultrathink:\nPlan the level",
    });
    const empty = traitsMenuState({
      provider: "claudeAgent",
      capabilities: CLAUDE_HAIKU,
      prompt: "",
    });
    assert.deepStrictEqual(chooseTrait(empty, "effort", "ultrathink", ""), {
      prompt: "Ultrathink:\n",
    });
  });

  it("takes the Ultrathink prefix off when another effort is chosen", () => {
    const prompt = "Ultrathink:\nPlan the level";
    const state = traitsMenuState({ provider: "claudeAgent", capabilities: CLAUDE_HAIKU, prompt });
    assert.deepStrictEqual(chooseTrait(state, "effort", "high", prompt), {
      prompt: "Plan the level",
      options: [{ id: "effort", value: "high" }],
    });
  });

  it("leaves the effort alone while the prompt's own words say ultrathink", () => {
    const prompt = "Please ultrathink about the boss fight";
    const state = traitsMenuState({ provider: "claudeAgent", capabilities: CLAUDE_HAIKU, prompt });
    assert.isTrue(state.ultrathinkInBodyText);
    assert.deepStrictEqual(chooseTrait(state, "effort", "high", prompt), {});
  });
});

describe("the traits a message carries", () => {
  it("are only the options chosen, so the rest stay the provider's default", () => {
    assert.isUndefined(traitsForDispatch(CLAUDE_HAIKU, undefined));
    assert.deepStrictEqual(
      traitsForDispatch(CODEX_TERRA, [{ id: "reasoningEffort", value: "high" }]),
      [{ id: "reasoningEffort", value: "high" }],
    );
  });

  it("say Fast Mode is off on a model that offers it, unless it was chosen", () => {
    assert.deepStrictEqual(traitsForDispatch(CLAUDE_OPUS, undefined), [
      { id: "fastMode", value: false },
    ]);
  });

  it("drop a choice the model does not offer", () => {
    assert.deepStrictEqual(
      traitsForDispatch(CODEX_TERRA, [
        { id: "reasoningEffort", value: "ultra" },
        { id: "fastMode", value: true },
      ]),
      [{ id: "reasoningEffort", value: "medium" }],
    );
  });
});

describe("remembered traits", () => {
  const memoryOver = () => {
    const stored = new Map<string, string>();
    return {
      stored,
      memory: makeTraitsMemory({
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => void stored.set(key, value),
      }),
    };
  };

  it("are kept per provider and model, across pages", () => {
    const { stored, memory } = memoryOver();
    memory.remember("codex", "gpt-5.6-terra", [{ id: "reasoningEffort", value: "high" }]);

    const later = makeTraitsMemory({
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => void stored.set(key, value),
    });
    assert.deepStrictEqual(later.recall("codex", "gpt-5.6-terra"), [
      { id: "reasoningEffort", value: "high" },
    ]);
    assert.isUndefined(later.recall("codex", "gpt-6.1-sol"));
    assert.isUndefined(later.recall("claudeAgent", "gpt-5.6-terra"));
  });

  it("are forgotten when the choices are cleared", () => {
    const { memory } = memoryOver();
    memory.remember("claudeAgent", "claude-opus-5-5", [{ id: "fastMode", value: true }]);
    memory.remember("claudeAgent", "claude-opus-5-5", undefined);
    assert.isUndefined(memory.recall("claudeAgent", "claude-opus-5-5"));
  });

  it("start empty when what was stored cannot be read", () => {
    const memory = makeTraitsMemory({ getItem: () => "{not json", setItem: () => undefined });
    assert.isUndefined(memory.recall("codex", "gpt-5.6-terra"));
  });
});

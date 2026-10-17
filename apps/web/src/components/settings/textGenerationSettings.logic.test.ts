import { assert, describe, it } from "@effect/vitest";
import type { ServerProvider } from "@playstead/contracts/server";
import { DEFAULT_TEXT_GENERATION_MODEL_SELECTION } from "@playstead/contracts/settings";

import { resolveTextGenerationSelection } from "./textGenerationSettings.logic.ts";

/**
 * Which provider and model **Settings → General → Text generation** shows
 * (T3 Code's `resolveAppModelSelectionState` in `apps/web/src/modelSelection.ts`
 * at 2577baf, ported as behaviour).
 */

const provider = (
  instanceId: ServerProvider["instanceId"],
  models: ReadonlyArray<string>,
  installed = true,
): ServerProvider =>
  ({
    instanceId,
    driver: instanceId,
    displayName: instanceId === "codex" ? "Codex" : "Claude",
    installed,
    models: models.map((slug, index) => ({
      slug,
      name: slug,
      ...(index === 0 ? { isDefault: true } : {}),
    })),
  }) as unknown as ServerProvider;

const codex = provider("codex", ["gpt-6-astra", "gpt-6-luna"]);
const claude = provider("claudeAgent", ["claude-fable-5-1", "claude-haiku-5-5"]);

describe("resolveTextGenerationSelection", () => {
  it("keeps the chosen provider, model and options while that provider can run it", () => {
    assert.deepStrictEqual(
      resolveTextGenerationSelection(DEFAULT_TEXT_GENERATION_MODEL_SELECTION, [codex, claude]),
      DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
    );
    const haiku = { instanceId: "claudeAgent", model: "claude-haiku-5-5" } as const;
    assert.deepStrictEqual(resolveTextGenerationSelection(haiku, [codex, claude]), haiku);
  });

  it("falls back to Claude's cheap model when Codex is not installed", () => {
    assert.deepStrictEqual(
      resolveTextGenerationSelection(DEFAULT_TEXT_GENERATION_MODEL_SELECTION, [
        provider("codex", [], false),
        claude,
      ]),
      { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
    );
  });

  it("falls back to Codex first when the chosen provider is not installed", () => {
    assert.deepStrictEqual(
      resolveTextGenerationSelection({ instanceId: "claudeAgent", model: "claude-haiku-5-5" }, [
        codex,
        provider("claudeAgent", [], false),
      ]),
      { instanceId: "codex", model: "gpt-6-luna" },
    );
  });

  it("uses the provider's cheap model, else its default, for a model it no longer lists", () => {
    assert.deepStrictEqual(
      resolveTextGenerationSelection({ instanceId: "claudeAgent", model: "claude-retired-1" }, [
        claude,
      ]),
      { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
    );
    assert.deepStrictEqual(
      resolveTextGenerationSelection(DEFAULT_TEXT_GENERATION_MODEL_SELECTION, [
        provider("codex", ["gpt-6-astra", "gpt-6-terra"]),
      ]),
      { instanceId: "codex", model: "gpt-6-astra" },
    );
  });

  it("keeps the setting as it is when no provider can generate text", () => {
    assert.deepStrictEqual(
      resolveTextGenerationSelection(DEFAULT_TEXT_GENERATION_MODEL_SELECTION, []),
      DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
    );
  });
});

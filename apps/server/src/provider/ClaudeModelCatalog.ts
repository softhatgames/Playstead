import type { ServerProviderModel } from "@playstead/contracts/server";

import { compareVersions, parseStableVersion } from "./providerCompatibility.ts";

interface ClaudeCatalogModel {
  readonly model: ServerProviderModel;
  /** The oldest Claude Code that runs the model. */
  readonly minVersion: string;
}

/**
 * Claude's models, from T3 Code's bundled catalog at 2577baf
 * (`providers.claudeAgent` in `apps/server/src/provider/model-manifest.json`,
 * read by `ClaudeModelCatalog.ts`): the models it marks current, its default
 * chat model and each model's `minVersion`. T3 Code also fetches that
 * manifest from GitHub and lists legacy models; Playstead keeps this list
 * fixed and fetches nothing. The list moves with the followed commit.
 */
const CLAUDE_MODEL_CATALOG: ReadonlyArray<ClaudeCatalogModel> = [
  { model: { slug: "claude-opus-5-5", name: "Claude Opus 5.5" }, minVersion: "2.1.280" },
  { model: { slug: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }, minVersion: "2.1.284" },
  {
    model: { slug: "claude-fable-5-1", name: "Claude Fable 5.1", isDefault: true },
    minVersion: "2.1.257",
  },
  { model: { slug: "claude-haiku-5-5", name: "Claude Haiku 5.5" }, minVersion: "2.1.293" },
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

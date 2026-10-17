import { assert, it } from "@effect/vitest";
import type { ServerProvider } from "@playstead/contracts/server";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import { resolveTextGenerationModelSelection } from "./TextGeneration.ts";

const provider = (instanceId: ProviderInstanceId, installed: boolean): ServerProvider => ({
  instanceId,
  driver: instanceId,
  displayName: instanceId,
  installed,
  version: null,
  status: "ready",
  auth: { status: "unknown" },
  checkedAt: "2026-10-17T00:00:00Z",
  models: [],
});
it("defaults to Codex low effort, falls back to Haiku, and preserves an available explicit selection", () => {
  assert.deepStrictEqual(
    resolveTextGenerationModelSelection(undefined, [
      provider("codex", true),
      provider("claudeAgent", true),
    ]),
    {
      instanceId: "codex",
      model: "gpt-6-luna",
      options: [{ id: "reasoningEffort", value: "low" }],
    },
  );
  assert.deepStrictEqual(
    resolveTextGenerationModelSelection(undefined, [
      provider("codex", false),
      provider("claudeAgent", true),
    ]),
    { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
  );
  const explicit = {
    instanceId: "claudeAgent" as const,
    model: "claude-sonnet-5-5",
    options: [{ id: "effort", value: "low" }],
  };
  assert.deepStrictEqual(
    resolveTextGenerationModelSelection(explicit, [
      provider("codex", true),
      provider("claudeAgent", true),
    ]),
    explicit,
  );
  assert.strictEqual(
    resolveTextGenerationModelSelection(explicit, [
      provider("codex", true),
      provider("claudeAgent", false),
    ]).model,
    "gpt-6-luna",
  );
});

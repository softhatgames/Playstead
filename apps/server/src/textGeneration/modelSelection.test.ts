import { assert, it } from "@effect/vitest";
import type { ServerProvider } from "@playstead/contracts/server";
import { DEFAULT_TEXT_GENERATION_MODEL_SELECTION } from "@playstead/contracts/settings";
import { resolveTextGenerationModelSelection } from "./TextGeneration.ts";
const provider = (instanceId: "codex" | "claudeAgent", installed: boolean): ServerProvider => ({
  instanceId,
  driver: instanceId,
  installed,
  displayName: instanceId,
  version: null,
  status: "ready",
  auth: { status: "unknown" },
  checkedAt: "",
  models: [],
});
it("keeps installed selections and options; missing selections fall back Codex then Claude", () => {
  const selected = {
    instanceId: "claudeAgent" as const,
    model: "custom-model",
    options: [{ id: "effort", value: "high" }],
  };
  assert.deepStrictEqual(
    resolveTextGenerationModelSelection(selected, [
      provider("claudeAgent", true),
      provider("codex", true),
    ]),
    selected,
  );
  assert.deepStrictEqual(
    resolveTextGenerationModelSelection(selected, [
      provider("claudeAgent", false),
      provider("codex", true),
    ]),
    DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
  );
  assert.deepStrictEqual(
    resolveTextGenerationModelSelection(DEFAULT_TEXT_GENERATION_MODEL_SELECTION, [
      provider("claudeAgent", true),
      provider("codex", false),
    ]),
    { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
  );
  assert.deepStrictEqual(resolveTextGenerationModelSelection(selected, []), selected);
});

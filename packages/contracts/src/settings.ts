import { ModelSelection } from "./orchestrationV2.ts";
import * as Schema from "effect/Schema";

import { ProviderInstanceConfig, type ProviderInstanceId } from "./providerInstance.ts";

/**
 * The server's settings, kept in `settings.json` in its state folder as
 * T3 Code keeps them: built-in instances' **Binary path** and the text
 * generation model. Old settings without a selection use the title defaults.
 */
export const ServerSettings = Schema.Struct({
  textGenerationModelSelection: Schema.optionalKey(ModelSelection),
  providerInstances: Schema.Struct({
    codex: Schema.optionalKey(ProviderInstanceConfig),
    claudeAgent: Schema.optionalKey(ProviderInstanceConfig),
  }),
});
export type ServerSettings = typeof ServerSettings.Type;

export class ServerSettingsError extends Schema.TaggedError<ServerSettingsError>()(
  "ServerSettingsError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/**
 * The command each instance runs when **Binary path** is empty, which is also
 * the field's placeholder (T3 Code's `makeBinaryPathSetting` at 2577baf).
 */
export const DEFAULT_BINARY_PATHS: Record<ProviderInstanceId, string> = {
  codex: "codex",
  claudeAgent: "claude",
};

/** Text generation defaults from T3 Code model.ts at 2577baf. */
export const DEFAULT_TEXT_GENERATION_MODELS: Record<ProviderInstanceId, ModelSelection> = {
  codex: {
    instanceId: "codex",
    model: "gpt-6-luna",
    options: [{ id: "reasoningEffort", value: "low" }],
  },
  claudeAgent: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
};

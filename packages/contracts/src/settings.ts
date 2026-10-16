import * as Schema from "effect/Schema";

import { ProviderInstanceConfig, type ProviderInstanceId } from "./providerInstance.ts";

/**
 * The server's settings, kept in `settings.json` in its state folder as
 * T3 Code keeps them. Only the two built-in instances' **Binary path** is
 * there; an instance without an entry uses its driver's default.
 */
export const ServerSettings = Schema.Struct({
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

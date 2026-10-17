import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DEFAULT_RUNTIME_MODE, RuntimeMode } from "./orchestrationV2.ts";
import { ProviderInstanceConfig, type ProviderInstanceId } from "./providerInstance.ts";

/**
 * The server's settings, kept in `settings.json` in its state folder as
 * T3 Code keeps them (`packages/contracts/src/settings.ts` at 2577baf):
 *
 * - the two built-in instances' **Binary path**; an instance without an
 *   entry uses its driver's default;
 * - `defaultRuntimeMode`, the permissions new threads start with (**Settings
 *   → General → New threads → Permissions**). A file saved before it existed
 *   decodes to Full access.
 */
export const ServerSettings = Schema.Struct({
  providerInstances: Schema.Struct({
    codex: Schema.optionalKey(ProviderInstanceConfig),
    claudeAgent: Schema.optionalKey(ProviderInstanceConfig),
  }),
  defaultRuntimeMode: RuntimeMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE)),
  ),
});
export type ServerSettings = typeof ServerSettings.Type;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = {
  providerInstances: {},
  defaultRuntimeMode: DEFAULT_RUNTIME_MODE,
};

/** The settings a change sets; the rest keep their values (T3 Code's `ServerSettingsPatch`). */
export const ServerSettingsPatch = Schema.Struct({
  defaultRuntimeMode: Schema.optionalKey(RuntimeMode),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;

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

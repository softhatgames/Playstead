import * as Schema from "effect/Schema";

/**
 * The drivers this slice has. T3 Code's driver kinds and default instance ids
 * at 2577baf are the same strings (`packages/contracts/src/model.ts`,
 * `settings.ts` `DEFAULT_ENABLED_DEFAULT_INSTANCES`).
 */
export const ProviderDriverKind = Schema.Literals(["codex", "claudeAgent"]);
export type ProviderDriverKind = typeof ProviderDriverKind.Type;

/**
 * The two built-in provider instances, always present. There are no other
 * instances, so an id is one of these.
 */
export const ProviderInstanceId = Schema.Literals(["codex", "claudeAgent"]);
export type ProviderInstanceId = typeof ProviderInstanceId.Type;

export const PROVIDER_INSTANCE_IDS: ReadonlyArray<ProviderInstanceId> = ["codex", "claudeAgent"];

/**
 * A provider instance's settings. **Binary path** is the only one; without it
 * the driver runs its default command from PATH.
 */
export const ProviderInstanceSettings = Schema.Struct({
  binaryPath: Schema.optionalKey(Schema.String),
});
export type ProviderInstanceSettings = typeof ProviderInstanceSettings.Type;

export const ProviderInstanceConfig = Schema.Struct({
  driver: ProviderDriverKind,
  config: Schema.optionalKey(ProviderInstanceSettings),
});
export type ProviderInstanceConfig = typeof ProviderInstanceConfig.Type;

/** T3 Code's mutation, trimmed to `upsert`: instances are never created or removed. */
export const ProviderInstanceMutation = Schema.Struct({
  operation: Schema.Literal("upsert"),
  instanceId: ProviderInstanceId,
  instance: ProviderInstanceConfig,
});
export type ProviderInstanceMutation = typeof ProviderInstanceMutation.Type;

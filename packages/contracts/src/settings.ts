import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DEFAULT_RUNTIME_MODE, ModelSelection, RuntimeMode } from "./orchestrationV2.ts";
import {
  type ProviderDriverKind,
  ProviderInstanceConfig,
  type ProviderInstanceId,
} from "./providerInstance.ts";

/**
 * The model text generation runs when nothing else is chosen, and the effort
 * it asks for (T3 Code's `DEFAULT_TEXT_GENERATION_MODEL` and
 * `DEFAULT_TEXT_GENERATION_REASONING_EFFORT` in
 * `packages/contracts/src/model.ts` at 2577baf).
 */
const DEFAULT_TEXT_GENERATION_MODEL = "gpt-6-luna";
export const DEFAULT_TEXT_GENERATION_REASONING_EFFORT = "low";

/**
 * Each driver's cheap model for text generation, which a fallback to that
 * driver uses (T3 Code's `DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER`).
 */
export const DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER: Record<ProviderDriverKind, string> = {
  codex: DEFAULT_TEXT_GENERATION_MODEL,
  claudeAgent: "claude-haiku-5-5",
};

/** T3 Code's default `textGenerationModelSelection`: Codex's cheap model at low effort. */
export const DEFAULT_TEXT_GENERATION_MODEL_SELECTION: ModelSelection = {
  instanceId: "codex",
  model: DEFAULT_TEXT_GENERATION_MODEL,
  options: [{ id: "reasoningEffort", value: DEFAULT_TEXT_GENERATION_REASONING_EFFORT }],
};

/**
 * How many days without activity before a thread settles by itself, within
 * T3 Code's bounds (`SidebarAutoSettleAfterDays`); null turns automatic
 * settlement off.
 */
export const MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS = 1;
export const MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS = 90;
const SidebarAutoSettleAfterDays = Schema.Number.check(
  Schema.isBetween({
    minimum: MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
    maximum: MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  }),
);
export const DEFAULT_SIDEBAR_AUTO_SETTLE_AFTER_DAYS = 3;

/**
 * The server's settings, kept in `settings.json` in its state folder as
 * T3 Code keeps them (`packages/contracts/src/settings.ts` at 2577baf):
 *
 * - the two built-in instances' **Binary path**; an instance without an
 *   entry uses its driver's default;
 * - `textGenerationModelSelection`, the provider and model that write
 *   thread titles (**Settings → General → Text generation**);
 * - `defaultRuntimeMode`, the permissions new threads start with (**Settings
 *   → General → New threads → Permissions**);
 * - `sidebarAutoSettleAfterDays`, the days without activity before a thread
 *   settles by itself, or null for never (**Settings → General →
 *   Organization**).
 *
 * A file saved before a setting existed decodes to T3 Code's default (Full
 * access for the permissions).
 */
export const ServerSettings = Schema.Struct({
  providerInstances: Schema.Struct({
    codex: Schema.optionalKey(ProviderInstanceConfig),
    claudeAgent: Schema.optionalKey(ProviderInstanceConfig),
  }),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_TEXT_GENERATION_MODEL_SELECTION)),
  ),
  defaultRuntimeMode: RuntimeMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE)),
  ),
  sidebarAutoSettleAfterDays: Schema.NullOr(SidebarAutoSettleAfterDays).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_AUTO_SETTLE_AFTER_DAYS)),
  ),
});
export type ServerSettings = typeof ServerSettings.Type;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = {
  providerInstances: {},
  textGenerationModelSelection: DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
  defaultRuntimeMode: DEFAULT_RUNTIME_MODE,
  sidebarAutoSettleAfterDays: DEFAULT_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
};

/** The settings a change sets; the rest keep their values (T3 Code's `ServerSettingsPatch`). */
export const ServerSettingsPatch = Schema.Struct({
  textGenerationModelSelection: Schema.optionalKey(ModelSelection),
  defaultRuntimeMode: Schema.optionalKey(RuntimeMode),
  sidebarAutoSettleAfterDays: Schema.optionalKey(Schema.NullOr(SidebarAutoSettleAfterDays)),
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

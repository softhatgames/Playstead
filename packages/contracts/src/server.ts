import * as Schema from "effect/Schema";

import { ServerAuthDescriptor } from "./auth.ts";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ExecutionEnvironmentDescriptor } from "./environment.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import { ServerSettings } from "./settings.ts";

export const ServerProviderState = Schema.Literals(["ready", "warning", "error"]);
export type ServerProviderState = typeof ServerProviderState.Type;

export const ServerProviderCompatibilityStatus = Schema.Literals([
  "unknown",
  "supported",
  "graceful",
  "unsupported",
  "broken",
]);
export type ServerProviderCompatibilityStatus = typeof ServerProviderCompatibilityStatus.Type;

/** How the found version sits against the ranges this release supports. */
export const ServerProviderCompatibilityAdvisory = Schema.Struct({
  status: ServerProviderCompatibilityStatus,
  message: Schema.NullOr(TrimmedNonEmptyString),
  recommendedVersion: Schema.NullOr(TrimmedNonEmptyString),
  recommendedRange: Schema.NullOr(TrimmedNonEmptyString),
});
export type ServerProviderCompatibilityAdvisory = typeof ServerProviderCompatibilityAdvisory.Type;

const ServerProviderAuthStatus = Schema.Literals(["authenticated", "unauthenticated", "unknown"]);

/**
 * Whether the provider's CLI is signed in, as T3 Code's `ServerProviderAuth`
 * at 2577baf without its sign-in actions: `type` is the account kind the
 * provider reports, `label` names it for people, and `email` is the account's
 * when the provider gives one.
 */
export const ServerProviderAuth = Schema.Struct({
  status: ServerProviderAuthStatus,
  type: Schema.optionalKey(TrimmedNonEmptyString),
  label: Schema.optionalKey(TrimmedNonEmptyString),
  email: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ServerProviderAuth = typeof ServerProviderAuth.Type;

/** A model the provider runs, as T3 Code's `ServerProviderModel` without custom models or capabilities. */
export const ServerProviderModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  isDefault: Schema.optionalKey(Schema.Boolean),
});
export type ServerProviderModel = typeof ServerProviderModel.Type;

/**
 * A provider instance's status, trimmed from T3 Code's `ServerProvider` at
 * 2577baf: whether it is installed, its version, whether it is signed in, its
 * models and the compatibility advisory.
 */
export const ServerProvider = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  displayName: TrimmedNonEmptyString,
  installed: Schema.Boolean,
  version: Schema.NullOr(TrimmedNonEmptyString),
  status: ServerProviderState,
  auth: ServerProviderAuth,
  checkedAt: Schema.String,
  message: Schema.optionalKey(TrimmedNonEmptyString),
  models: Schema.Array(ServerProviderModel),
  compatibilityAdvisory: Schema.optionalKey(ServerProviderCompatibilityAdvisory),
});
export type ServerProvider = typeof ServerProvider.Type;

export const ServerProviders = Schema.Array(ServerProvider);
export type ServerProviders = typeof ServerProviders.Type;

export const ServerProviderUpdatedPayload = Schema.Struct({ providers: ServerProviders });
export type ServerProviderUpdatedPayload = typeof ServerProviderUpdatedPayload.Type;

/** The server's status as a client sees it on connecting. */
export const ServerConfig = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
  auth: ServerAuthDescriptor,
  providers: ServerProviders,
  settings: ServerSettings,
});
export type ServerConfig = typeof ServerConfig.Type;

const ServerConfigStreamSnapshotEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("snapshot"),
  config: ServerConfig,
});

const ServerConfigStreamProviderStatusesEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("providerStatuses"),
  payload: ServerProviderUpdatedPayload,
});

const ServerConfigStreamSettingsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("settingsUpdated"),
  payload: Schema.Struct({ settings: ServerSettings }),
});

/**
 * T3 Code's config stream, trimmed: the config first, then each change to
 * provider statuses or settings.
 */
export const ServerConfigStreamEvent = Schema.Union([
  ServerConfigStreamSnapshotEvent,
  ServerConfigStreamProviderStatusesEvent,
  ServerConfigStreamSettingsUpdatedEvent,
]);
export type ServerConfigStreamEvent = typeof ServerConfigStreamEvent.Type;

const ServerLifecycleWelcomePayload = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
});
export type ServerLifecycleWelcomePayload = typeof ServerLifecycleWelcomePayload.Type;

const ServerLifecycleReadyPayload = Schema.Struct({
  at: Schema.DateTimeUtc,
  environment: ExecutionEnvironmentDescriptor,
});
export type ServerLifecycleReadyPayload = typeof ServerLifecycleReadyPayload.Type;

const ServerLifecycleStreamWelcomeEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("welcome"),
  payload: ServerLifecycleWelcomePayload,
});
export type ServerLifecycleStreamWelcomeEvent = typeof ServerLifecycleStreamWelcomeEvent.Type;

const ServerLifecycleStreamReadyEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("ready"),
  payload: ServerLifecycleReadyPayload,
});
export type ServerLifecycleStreamReadyEvent = typeof ServerLifecycleStreamReadyEvent.Type;

/** The environment's status: `welcome` once it has started, `ready` once commands run. */
export const ServerLifecycleStreamEvent = Schema.Union([
  ServerLifecycleStreamWelcomeEvent,
  ServerLifecycleStreamReadyEvent,
]);
export type ServerLifecycleStreamEvent = typeof ServerLifecycleStreamEvent.Type;

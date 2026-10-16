import * as Schema from "effect/Schema";

import { ServerAuthDescriptor } from "./auth.ts";
import { NonNegativeInt } from "./baseSchemas.ts";
import { ExecutionEnvironmentDescriptor } from "./environment.ts";

/** The server's status as a client sees it on connecting. */
export const ServerConfig = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
  auth: ServerAuthDescriptor,
});
export type ServerConfig = typeof ServerConfig.Type;

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

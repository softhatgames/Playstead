import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

const TrimmedString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transformEffect({
      decode: (value) => Effect.succeed(value.trim()),
      encode: (value) => Effect.succeed(value.trim()),
    }),
  ),
);

/**
 * Trimming happens only on decode and encode, so a plain non-empty check would
 * still let `make(" ")` through and encode it to `""`.
 */
const isNonBlank = Schema.makeFilter((value: string) => value.trim().length > 0, {
  expected: "a non-blank string",
});

export const TrimmedNonEmptyString = TrimmedString.check(isNonBlank);

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const makeEntityId = <Brand extends string>(brand: Parameters<typeof Schema.brand<Brand>>[0]) =>
  TrimmedNonEmptyString.pipe(Schema.brand<Brand>(brand));

export const EnvironmentId = makeEntityId("EnvironmentId");
export type EnvironmentId = typeof EnvironmentId.Type;

export const AuthSessionId = makeEntityId("AuthSessionId");
export type AuthSessionId = typeof AuthSessionId.Type;

/** An ISO 8601 date and time, as T3 Code's `IsoDateTime` keeps it: a plain string. */
export const IsoDateTime = Schema.String;
export type IsoDateTime = typeof IsoDateTime.Type;

export const ProjectId = makeEntityId("ProjectId");
export type ProjectId = typeof ProjectId.Type;

export const CommandId = makeEntityId("CommandId");
export type CommandId = typeof CommandId.Type;

export const EventId = makeEntityId("EventId");
export type EventId = typeof EventId.Type;

/** Orchestration's ids, as T3 Code's `packages/contracts/src/baseSchemas.ts` at 2577baf names them. */
export const ThreadId = makeEntityId("ThreadId");
export type ThreadId = typeof ThreadId.Type;

export const RunId = makeEntityId("RunId");
export type RunId = typeof RunId.Type;

export const RunAttemptId = makeEntityId("RunAttemptId");
export type RunAttemptId = typeof RunAttemptId.Type;

export const NodeId = makeEntityId("NodeId");
export type NodeId = typeof NodeId.Type;

export const MessageId = makeEntityId("MessageId");
export type MessageId = typeof MessageId.Type;

export const TurnItemId = makeEntityId("TurnItemId");
export type TurnItemId = typeof TurnItemId.Type;

export const ProviderSessionId = makeEntityId("ProviderSessionId");
export type ProviderSessionId = typeof ProviderSessionId.Type;

export const ProviderThreadId = makeEntityId("ProviderThreadId");
export type ProviderThreadId = typeof ProviderThreadId.Type;

export const ProviderTurnId = makeEntityId("ProviderTurnId");
export type ProviderTurnId = typeof ProviderTurnId.Type;

export const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

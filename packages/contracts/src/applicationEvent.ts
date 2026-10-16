import * as Schema from "effect/Schema";

import {
  CommandId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/**
 * Project events, as T3 Code's `packages/contracts/src/applicationEvent.ts`
 * at 2577baf stores them beside the agent events in one sequence. Only
 * `project.created` exists: projects are not updated or deleted yet.
 */

const ApplicationProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ApplicationProjectCreatedPayload = typeof ApplicationProjectCreatedPayload.Type;

const ApplicationProjectCreatedEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("project"),
  aggregateId: ProjectId,
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  type: Schema.Literal("project.created"),
  payload: ApplicationProjectCreatedPayload,
});
export type ApplicationProjectCreatedEvent = typeof ApplicationProjectCreatedEvent.Type;

export const ApplicationProjectEvent = Schema.Union([ApplicationProjectCreatedEvent]);
export type ApplicationProjectEvent = typeof ApplicationProjectEvent.Type;

/** Every stored application event. Agent events join with the orchestration core. */
export type ApplicationStoredEvent = ApplicationProjectEvent;

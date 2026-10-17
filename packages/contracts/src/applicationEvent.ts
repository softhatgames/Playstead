import * as Schema from "effect/Schema";

import {
  CommandId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import type { OrchestrationV2StoredEvent } from "./orchestrationV2.ts";

/**
 * Project events, as T3 Code's `packages/contracts/src/applicationEvent.ts`
 * at 2577baf stores them beside the agent events in one sequence: a project
 * is created, renamed (`project.meta-updated`, with the title only, since
 * Playstead's projects have nothing else to change yet) and removed.
 */

const ApplicationProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ApplicationProjectCreatedPayload = typeof ApplicationProjectCreatedPayload.Type;

const ApplicationProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optionalKey(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});

const ApplicationProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

const ApplicationProjectEventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("project"),
  aggregateId: ProjectId,
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
} as const;

const ApplicationProjectCreatedEvent = Schema.Struct({
  ...ApplicationProjectEventBaseFields,
  type: Schema.Literal("project.created"),
  payload: ApplicationProjectCreatedPayload,
});

const ApplicationProjectMetaUpdatedEvent = Schema.Struct({
  ...ApplicationProjectEventBaseFields,
  type: Schema.Literal("project.meta-updated"),
  payload: ApplicationProjectMetaUpdatedPayload,
});

const ApplicationProjectDeletedEvent = Schema.Struct({
  ...ApplicationProjectEventBaseFields,
  type: Schema.Literal("project.deleted"),
  payload: ApplicationProjectDeletedPayload,
});

export const ApplicationProjectEvent = Schema.Union([
  ApplicationProjectCreatedEvent,
  ApplicationProjectMetaUpdatedEvent,
  ApplicationProjectDeletedEvent,
]);
export type ApplicationProjectEvent = typeof ApplicationProjectEvent.Type;

/** Every stored application event: project events and thread events, in one sequence. */
export type ApplicationStoredEvent = ApplicationProjectEvent | OrchestrationV2StoredEvent;

import { type CommandId, type EventId, ProjectId } from "@playstead/contracts/baseSchemas";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { UnsequencedProjectEvent } from "./EventStore.ts";
import type { ProjectRow } from "./ProjectStore.ts";

export interface ProjectCreateCommand {
  readonly type: "project.create";
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
  readonly title: string;
  /** Already normalized: resolved, absolute and an existing folder. */
  readonly workspaceRoot: string;
}

export type ProjectCommand =
  | ProjectCreateCommand
  | {
      readonly type: "project.update";
      readonly commandId: CommandId;
      readonly projectId: ProjectId;
      readonly title: string;
    }
  | {
      readonly type: "project.delete";
      readonly commandId: CommandId;
      readonly projectId: ProjectId;
    };

class ProjectCommandInvariantError extends Schema.TaggedError<ProjectCommandInvariantError>()(
  "ProjectCommandInvariantError",
  { commandType: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Project command ${this.commandType} broke an invariant: ${this.detail}`;
  }
}

class ProjectWorkspaceConflictError extends Schema.TaggedError<ProjectWorkspaceConflictError>()(
  "ProjectWorkspaceConflictError",
  { workspaceRoot: Schema.String, conflictingProjectId: ProjectId },
) {
  override get message(): string {
    return `Project ${this.conflictingProjectId} already has the folder ${this.workspaceRoot}.`;
  }
}

/** Why a project command was rejected, kept in its receipt as JSON. */
export const ProjectCommandRejection = Schema.Union([
  ProjectCommandInvariantError,
  ProjectWorkspaceConflictError,
]);
export type ProjectCommandRejection = typeof ProjectCommandRejection.Type;

const ProjectCommandRejectionJson = Schema.fromJsonString(ProjectCommandRejection);
export const encodeProjectCommandRejection = Schema.encodeSync(ProjectCommandRejectionJson);
export const decodeProjectCommandRejection = Schema.decodeUnknownOption(
  ProjectCommandRejectionJson,
);

/** What the command is decided against, read under the project's and folder's locks. */
export interface ProjectCommandState {
  readonly project: ProjectRow | undefined;
  readonly workspaceOwner: ProjectRow | undefined;
}

/**
 * Decides a project command's event, without I/O (T3 Code's
 * `planProjectCommand`, `apps/server/src/orchestration-v2/ProjectCommands.ts`
 * at 2577baf): a project id is created once, and a folder belongs to one
 * project.
 */
export function planProjectCommand(input: {
  readonly command: ProjectCommand;
  readonly state: ProjectCommandState;
  readonly eventId: EventId;
  readonly now: DateTime.Utc;
}): Result.Result<UnsequencedProjectEvent, ProjectCommandRejection> {
  const { command, state } = input;
  const occurredAt = DateTime.formatIso(input.now);
  switch (command.type) {
    case "project.update":
    case "project.delete": {
      if (state.project === undefined || state.project.deletedAt !== null) {
        return Result.fail(
          new ProjectCommandInvariantError({
            commandType: command.type,
            detail: "Project not found.",
          }),
        );
      }
      if (command.type === "project.update")
        return Result.succeed({
          eventId: input.eventId,
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
          causationEventId: null,
          correlationId: command.commandId,
          type: "project.updated",
          payload: { projectId: command.projectId, title: command.title, updatedAt: occurredAt },
        });
      return Result.succeed({
        eventId: input.eventId,
        aggregateKind: "project",
        aggregateId: command.projectId,
        occurredAt,
        commandId: command.commandId,
        causationEventId: null,
        correlationId: command.commandId,
        type: "project.deleted",
        payload: { projectId: command.projectId, deletedAt: occurredAt },
      });
    }
    case "project.create": {
      if (state.project !== undefined) {
        return Result.fail(
          new ProjectCommandInvariantError({
            commandType: command.type,
            detail: `Project ${command.projectId} already exists.`,
          }),
        );
      }
      if (state.workspaceOwner !== undefined) {
        return Result.fail(
          new ProjectWorkspaceConflictError({
            workspaceRoot: command.workspaceRoot,
            conflictingProjectId: state.workspaceOwner.projectId,
          }),
        );
      }
      return Result.succeed({
        eventId: input.eventId,
        aggregateKind: "project",
        aggregateId: command.projectId,
        occurredAt,
        commandId: command.commandId,
        causationEventId: null,
        correlationId: command.commandId,
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      });
    }
  }
}

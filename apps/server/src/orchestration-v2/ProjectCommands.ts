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

export interface ProjectMetaUpdateCommand {
  readonly type: "project.meta.update";
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
  readonly title?: string;
}

/** The project's threads are deleted by `ProjectService` before this commits. */
export interface ProjectDeleteCommand {
  readonly type: "project.delete";
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
}

export type ProjectCommand = ProjectCreateCommand | ProjectMetaUpdateCommand | ProjectDeleteCommand;

class ProjectCommandInvariantError extends Schema.TaggedError<ProjectCommandInvariantError>()(
  "ProjectCommandInvariantError",
  { commandType: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Project command ${this.commandType} broke an invariant: ${this.detail}`;
  }
}

class ProjectCommandMissingProjectError extends Schema.TaggedError<ProjectCommandMissingProjectError>()(
  "ProjectCommandMissingProjectError",
  { commandType: Schema.String, projectId: ProjectId },
) {
  override get message(): string {
    return `Project ${this.projectId} does not exist for ${this.commandType}.`;
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
  ProjectCommandMissingProjectError,
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
  /** The project's row, removed or not. */
  readonly project: ProjectRow | undefined;
  /** The project not removed that has the command's folder. */
  readonly workspaceOwner: ProjectRow | undefined;
}

/**
 * Decides a project command's event, without I/O (T3 Code's
 * `planProjectCommand`, `apps/server/src/orchestration-v2/ProjectCommands.ts`
 * at 2577baf): a project id is created once, a folder belongs to one
 * project not removed, and only a project not removed is renamed or removed.
 */
export function planProjectCommand(input: {
  readonly command: ProjectCommand;
  readonly state: ProjectCommandState;
  readonly eventId: EventId;
  readonly now: DateTime.Utc;
}): Result.Result<UnsequencedProjectEvent, ProjectCommandRejection> {
  const { command, state } = input;
  const occurredAt = DateTime.formatIso(input.now);
  const activeProject = state.project?.deletedAt === null ? state.project : undefined;
  const missingProject = () =>
    Result.fail(
      new ProjectCommandMissingProjectError({
        commandType: command.type,
        projectId: command.projectId,
      }),
    );
  const base = {
    eventId: input.eventId,
    aggregateKind: "project" as const,
    aggregateId: command.projectId,
    occurredAt,
    commandId: command.commandId,
    causationEventId: null,
    correlationId: command.commandId,
  };
  switch (command.type) {
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
        ...base,
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
    case "project.meta.update": {
      if (activeProject === undefined) return missingProject();
      return Result.succeed({
        ...base,
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title === undefined ? {} : { title: command.title }),
          updatedAt: occurredAt,
        },
      });
    }
    case "project.delete": {
      if (activeProject === undefined) return missingProject();
      return Result.succeed({
        ...base,
        type: "project.deleted",
        payload: { projectId: command.projectId, deletedAt: occurredAt },
      });
    }
  }
}

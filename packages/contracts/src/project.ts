import * as Schema from "effect/Schema";

import { CommandId, IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Projects, trimmed from T3 Code's `packages/contracts/src/project.ts` at
 * 2577baf to folder management: no scripts, icons, default
 * model or repository identity.
 */

export const Project = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Project = typeof Project.Type;

export const ProjectCreatePayload = Schema.Struct({
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  /** Add project asks for this, so a path to a folder that is not there yet makes it. */
  createWorkspaceRootIfMissing: Schema.optionalKey(Schema.Boolean),
});
export type ProjectCreatePayload = typeof ProjectCreatePayload.Type;

export const ProjectDeletePayload = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  force: Schema.optionalKey(Schema.Boolean),
});
export type ProjectDeletePayload = typeof ProjectDeletePayload.Type;

export const ProjectUpdatePayload = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
});
export type ProjectUpdatePayload = typeof ProjectUpdatePayload.Type;

export const ProjectMutation = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("project.create"),
    commandId: CommandId,
    projectId: ProjectId,
    ...ProjectCreatePayload.fields,
  }),
  Schema.Struct({ type: Schema.Literal("project.update"), ...ProjectUpdatePayload.fields }),
  Schema.Struct({ type: Schema.Literal("project.delete"), ...ProjectDeletePayload.fields }),
]);
export type ProjectMutation = typeof ProjectMutation.Type;

export class ProjectMutationError extends Schema.TaggedError<ProjectMutationError>()(
  "ProjectMutationError",
  {
    commandId: CommandId,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

/**
 * The folder already belongs to another project. T3 Code folds this into
 * `ProjectMutationError`; Playstead passes it through so the client can open
 * the project that owns the folder.
 */
export class ProjectConflictError extends Schema.TaggedError<ProjectConflictError>()(
  "ProjectConflictError",
  {
    projectId: ProjectId,
    workspaceRoot: Schema.String,
    conflictingProjectId: ProjectId,
  },
) {
  override get message(): string {
    return `Workspace ${this.workspaceRoot} already belongs to project ${this.conflictingProjectId}.`;
  }
}

export class ProjectNotEmptyError extends Schema.TaggedError<ProjectNotEmptyError>()(
  "ProjectNotEmptyError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return "Project is not empty. Delete all threads in this project before removing it.";
  }
}

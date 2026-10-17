import * as Schema from "effect/Schema";

import { CommandId, IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Projects, trimmed from T3 Code's `packages/contracts/src/project.ts` at
 * 2577baf to adding a folder, renaming and removing: no scripts, icons,
 * default model or repository identity, and no moving to another folder.
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

/** What a project's update may change: only its title so far. */
export const ProjectUpdatePayload = Schema.Struct({
  title: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ProjectUpdatePayload = typeof ProjectUpdatePayload.Type;

/**
 * `project.delete` removes the project entry, never its folder. A project
 * with threads, archived ones included, is refused unless `force` is set,
 * which deletes its threads first.
 */
export const ProjectMutation = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("project.create"),
    commandId: CommandId,
    projectId: ProjectId,
    ...ProjectCreatePayload.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("project.update"),
    commandId: CommandId,
    projectId: ProjectId,
    ...ProjectUpdatePayload.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("project.delete"),
    commandId: CommandId,
    projectId: ProjectId,
    force: Schema.optionalKey(Schema.Boolean),
  }),
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

/** `projects.ensureScratch`: the "No project" project, found or created. */
export const ProjectEnsureScratchResult = Schema.Struct({ projectId: ProjectId });
export type ProjectEnsureScratchResult = typeof ProjectEnsureScratchResult.Type;

/**
 * "No project" is unavailable, or its folder or project could not be made.
 * T3 Code sends `OrchestrationDispatchCommandError`, whose Playstead form
 * needs a command id this request has none of.
 */
export class ProjectEnsureScratchError extends Schema.TaggedError<ProjectEnsureScratchError>()(
  "ProjectEnsureScratchError",
  { message: Schema.String },
) {}

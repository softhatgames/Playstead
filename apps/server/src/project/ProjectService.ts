import { CommandId, EventId, ProjectId, type ThreadId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import {
  type Project,
  ProjectConflictError,
  type ProjectCreatePayload,
  type ProjectUpdatePayload,
} from "@playstead/contracts/project";
import * as KeyedLock from "@playstead/shared/keyedLock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import {
  decodeProjectCommandRejection,
  encodeProjectCommandRejection,
  planProjectCommand,
  type ProjectCommand,
} from "../orchestration-v2/ProjectCommands.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

export interface ProjectCreateInput extends ProjectCreatePayload {
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
}

export interface ProjectUpdateInput extends ProjectUpdatePayload {
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
}

export interface ProjectDeleteInput {
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
  /** Deletes the project's threads, archived ones included, before removing it. */
  readonly force?: boolean;
}

class ProjectNotFoundError extends Schema.TaggedError<ProjectNotFoundError>()(
  "ProjectNotFoundError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return `Project ${this.projectId} was not found.`;
  }
}

/** The project still has threads and removing it was not forced. */
class ProjectNotEmptyError extends Schema.TaggedError<ProjectNotEmptyError>()(
  "ProjectNotEmptyError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return `Project ${this.projectId} is not empty.`;
  }
}

export class ProjectOperationError extends Schema.TaggedError<ProjectOperationError>()(
  "ProjectOperationError",
  {
    operation: Schema.Literals([
      "normalize-workspace",
      "read-project",
      "list-projects",
      "list-threads",
      "delete-thread",
      "dispatch-project-command",
    ]),
    projectId: Schema.optionalKey(ProjectId),
    workspaceRoot: Schema.optionalKey(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Project operation '${this.operation}' failed${this.projectId === undefined ? "" : ` for ${this.projectId}`}.`;
  }
}

export type ProjectServiceError =
  | ProjectNotFoundError
  | ProjectConflictError
  | ProjectNotEmptyError
  | ProjectOperationError;

/**
 * Projects: adding a folder, renaming, removing, and reading them back (T3
 * Code's `apps/server/src/project/ProjectService.ts` at 2577baf, `create`,
 * `update`, `delete` and the shell reads). Each command is decided by
 * `planProjectCommand` under the project's lock (and the folder's, for a
 * create) and committed through the event sink, so the event, the
 * projection row and the receipt land together.
 *
 * Removing a project never touches its folder. A project with threads,
 * archived ones included, is refused unless forced; forced, each thread is
 * deleted first through the orchestrator under a command id of its own
 * (`<command>:delete-thread:<thread>`), and only then is the project
 * removed, so a removal cut short is finished by sending it again.
 */
export class ProjectService extends Context.Service<
  ProjectService,
  {
    readonly create: (input: ProjectCreateInput) => Effect.Effect<Project, ProjectServiceError>;
    readonly update: (input: ProjectUpdateInput) => Effect.Effect<Project, ProjectServiceError>;
    /** Gives back the project as it was when removed. */
    readonly delete: (input: ProjectDeleteInput) => Effect.Effect<Project, ProjectServiceError>;
    /** A removed project is none. */
    readonly getShell: (
      projectId: ProjectId,
    ) => Effect.Effect<Option.Option<OrchestrationProjectShell>, ProjectOperationError>;
    readonly listShells: Effect.Effect<
      ReadonlyArray<OrchestrationProjectShell>,
      ProjectOperationError
    >;
  }
>()("@playstead/server/project/ProjectService") {}

const toProject = (row: ProjectStore.ProjectRow): Project => ({
  id: row.projectId,
  title: row.title,
  workspaceRoot: row.workspaceRoot,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const crypto = yield* Crypto.Crypto;
  const projectLocks = yield* KeyedLock.make<ProjectId>();
  const workspaceLocks = yield* KeyedLock.make<string>();

  const readRow = (projectId: ProjectId, options?: ProjectStore.ProjectReadOptions) =>
    projects
      .get(projectId, options)
      .pipe(
        Effect.mapError(
          (cause) => new ProjectOperationError({ operation: "read-project", projectId, cause }),
        ),
      );

  const readCommitted = Effect.fn("ProjectService.readCommitted")(function* (projectId: ProjectId) {
    const row = yield* readRow(projectId, { includeDeleted: true });
    if (Option.isNone(row)) {
      return yield* new ProjectOperationError({
        operation: "read-project",
        projectId,
        cause: "The accepted command left no project row.",
      });
    }
    return toProject(row.value);
  });

  const commit = Effect.fn("ProjectService.commit")(function* (command: ProjectCommand) {
    const { projectId } = command;
    const workspaceRoot = command.type === "project.create" ? command.workspaceRoot : undefined;
    const dispatchError = (cause: unknown) =>
      new ProjectOperationError({ operation: "dispatch-project-command", projectId, cause });

    const planAndCommit = Effect.gen(function* () {
      const project = Option.getOrUndefined(
        yield* projects.get(projectId, { includeDeleted: true }),
      );
      const workspaceOwner =
        workspaceRoot === undefined
          ? undefined
          : Option.getOrUndefined(yield* projects.findActiveByWorkspaceRoot(workspaceRoot));
      const now = yield* DateTime.now;
      const eventId = EventId.make(`event:${yield* crypto.randomUUIDv4()}`);
      const planned = planProjectCommand({
        command,
        state: { project, workspaceOwner },
        eventId,
        now,
      });
      if (Result.isSuccess(planned)) {
        const { receipt } = yield* eventSink.commitProjectCommand({
          commandId: command.commandId,
          projectId,
          commandType: command.type,
          acceptedAt: now,
          event: planned.success,
        });
        return receipt;
      }
      return yield* eventSink.commitRejectedProjectCommand({
        commandId: command.commandId,
        projectId,
        commandType: command.type,
        rejectedAt: now,
        error: encodeProjectCommandRejection(planned.failure),
      });
    });

    const receipt = yield* projectLocks
      .withLock(
        projectId,
        workspaceRoot === undefined
          ? planAndCommit
          : workspaceLocks.withLock(workspaceRoot, planAndCommit),
      )
      .pipe(Effect.mapError(dispatchError));
    if (receipt.projectId !== projectId || receipt.commandType !== command.type) {
      return yield* dispatchError(
        `Command ${command.commandId} was already used by ${receipt.commandType} for ${receipt.projectId}.`,
      );
    }
    // A retried command is decided against the state it already produced, so
    // its first receipt, not the new decision, is the outcome.
    if (receipt.status === "accepted") return;
    const rejection = Option.getOrUndefined(decodeProjectCommandRejection(receipt.error));
    if (rejection?._tag === "ProjectWorkspaceConflictError") {
      return yield* new ProjectConflictError({
        projectId,
        workspaceRoot: rejection.workspaceRoot,
        conflictingProjectId: rejection.conflictingProjectId,
      });
    }
    if (rejection?._tag === "ProjectCommandMissingProjectError") {
      return yield* new ProjectNotFoundError({ projectId });
    }
    return yield* dispatchError(rejection ?? receipt.error ?? "The command was rejected.");
  });

  const create = Effect.fn("ProjectService.create")(function* (input: ProjectCreateInput) {
    const workspaceRoot = yield* workspacePaths
      .normalizeWorkspaceRoot(input.workspaceRoot, {
        createIfMissing: input.createWorkspaceRootIfMissing ?? false,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProjectOperationError({
              operation: "normalize-workspace",
              projectId: input.projectId,
              workspaceRoot: input.workspaceRoot,
              cause,
            }),
        ),
      );
    yield* commit({
      type: "project.create",
      commandId: input.commandId,
      projectId: input.projectId,
      title: input.title,
      workspaceRoot,
    });
    return yield* readCommitted(input.projectId);
  });

  const update = Effect.fn("ProjectService.update")(function* (input: ProjectUpdateInput) {
    if (Option.isNone(yield* readRow(input.projectId))) {
      return yield* new ProjectNotFoundError({ projectId: input.projectId });
    }
    yield* commit({
      type: "project.meta.update",
      commandId: input.commandId,
      projectId: input.projectId,
      ...(input.title === undefined ? {} : { title: input.title }),
    });
    return yield* readCommitted(input.projectId);
  });

  const deleteChildThread = (input: ProjectDeleteInput, threadId: ThreadId) =>
    orchestrator.dispatch({
      type: "thread.delete",
      commandId: CommandId.make(`${input.commandId}:delete-thread:${threadId}`),
      threadId,
    });

  const deleteChildThreads = Effect.fn("ProjectService.deleteChildThreads")(function* (
    input: ProjectDeleteInput,
  ) {
    const { projectId } = input;
    const threads = yield* Effect.all([
      projections.listThreadShells("active"),
      projections.listThreadShells("archive"),
    ]).pipe(
      Effect.map((lists) => lists.flat().filter((thread) => thread.projectId === projectId)),
      Effect.mapError(
        (cause) => new ProjectOperationError({ operation: "list-threads", projectId, cause }),
      ),
    );
    if (threads.length > 0 && input.force !== true) {
      return yield* new ProjectNotEmptyError({ projectId });
    }
    // The threads go first and each durably, so a removal cut short can be retried.
    yield* Effect.forEach(
      threads,
      (thread) =>
        deleteChildThread(input, thread.id).pipe(
          Effect.mapError(
            (cause) => new ProjectOperationError({ operation: "delete-thread", projectId, cause }),
          ),
        ),
      { discard: true },
    );
  });

  const deleteProject = Effect.fn("ProjectService.delete")(function* (input: ProjectDeleteInput) {
    const { projectId } = input;
    // A removed project still reaches commit, so a retried command id gets
    // its receipt back and any other is refused as not found.
    const existing = yield* readRow(projectId, { includeDeleted: true });
    if (Option.isNone(existing)) {
      return yield* new ProjectNotFoundError({ projectId });
    }
    if (existing.value.deletedAt === null) {
      yield* deleteChildThreads(input);
    }
    yield* commit({ type: "project.delete", commandId: input.commandId, projectId });
    return yield* readCommitted(projectId);
  });

  return ProjectService.of({
    create,
    update,
    delete: deleteProject,
    getShell: (projectId) =>
      projects
        .getShell(projectId)
        .pipe(
          Effect.mapError(
            (cause) => new ProjectOperationError({ operation: "read-project", projectId, cause }),
          ),
        ),
    listShells: projects.listShells.pipe(
      Effect.mapError((cause) => new ProjectOperationError({ operation: "list-projects", cause })),
    ),
  });
});

export const layer = Layer.effect(ProjectService, make);

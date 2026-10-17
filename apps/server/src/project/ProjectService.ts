import { CommandId, EventId, ProjectId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import {
  type Project,
  type ProjectDeletePayload,
  type ProjectUpdatePayload,
  ProjectConflictError,
  ProjectNotEmptyError,
  type ProjectCreatePayload,
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

import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import {
  decodeProjectCommandRejection,
  encodeProjectCommandRejection,
  planProjectCommand,
  type ProjectCommand,
} from "../orchestration-v2/ProjectCommands.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

export interface ProjectCreateInput extends ProjectCreatePayload {
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
}

export class ProjectOperationError extends Schema.TaggedError<ProjectOperationError>()(
  "ProjectOperationError",
  {
    operation: Schema.Literals([
      "normalize-workspace",
      "read-project",
      "list-projects",
      "delete-thread",
      "list-threads",
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
  | ProjectConflictError
  | ProjectNotEmptyError
  | ProjectOperationError;

/**
 * Projects: adding a folder, and reading them back (T3 Code's
 * `apps/server/src/project/ProjectService.ts` at 2577baf, `create` and the
 * shell reads only). A create is decided by `planProjectCommand` under the
 * folder's and the project's locks and committed through the event sink, so
 * the event, the projection row and the receipt land together.
 */
export class ProjectService extends Context.Service<
  ProjectService,
  {
    readonly update: (input: ProjectUpdatePayload) => Effect.Effect<Project, ProjectServiceError>;
    readonly delete: (input: ProjectDeletePayload) => Effect.Effect<Project, ProjectServiceError>;
    readonly create: (input: ProjectCreateInput) => Effect.Effect<Project, ProjectServiceError>;
    readonly getShell: (
      projectId: ProjectId,
    ) => Effect.Effect<Option.Option<OrchestrationProjectShell>, ProjectOperationError>;
    readonly listShells: Effect.Effect<
      ReadonlyArray<OrchestrationProjectShell>,
      ProjectOperationError
    >;
  }
>()("@playstead/server/project/ProjectService") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const crypto = yield* Crypto.Crypto;
  const projectLocks = yield* KeyedLock.make<ProjectId>();
  const workspaceLocks = yield* KeyedLock.make<string>();

  const commit = Effect.fn("ProjectService.commit")(function* (command: ProjectCommand) {
    const { projectId } = command;
    const workspaceRoot = command.type === "project.create" ? command.workspaceRoot : projectId;
    const dispatchError = (cause: unknown) =>
      new ProjectOperationError({ operation: "dispatch-project-command", projectId, cause });

    const planAndCommit = Effect.gen(function* () {
      const project = Option.getOrUndefined(yield* projects.get(projectId));
      const workspaceOwner = Option.getOrUndefined(
        yield* command.type === "project.create"
          ? projects.findByWorkspaceRoot(workspaceRoot)
          : Effect.succeedNone,
      );
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
      .withLock(projectId, workspaceLocks.withLock(workspaceRoot, planAndCommit))
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
    const row = yield* projects.get(input.projectId).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectOperationError({
            operation: "read-project",
            projectId: input.projectId,
            cause,
          }),
      ),
    );
    if (Option.isNone(row)) {
      return yield* new ProjectOperationError({
        operation: "read-project",
        projectId: input.projectId,
        cause: "The accepted command left no project row.",
      });
    }
    return {
      id: row.value.projectId,
      title: row.value.title,
      workspaceRoot: row.value.workspaceRoot,
      createdAt: row.value.createdAt,
      updatedAt: row.value.updatedAt,
    } satisfies Project;
  });

  const deleteProject = Effect.fn("ProjectService.delete")(function* (input: ProjectDeletePayload) {
    const previous = yield* Effect.all({
      project: receipts.getProjectByCommandId(input.commandId),
      thread: receipts.getByCommandId(input.commandId),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectOperationError({
            operation: "dispatch-project-command",
            projectId: input.projectId,
            cause,
          }),
      ),
    );
    if (
      Option.isSome(previous.thread) ||
      (Option.isSome(previous.project) &&
        (previous.project.value.projectId !== input.projectId ||
          previous.project.value.commandType !== "project.delete"))
    ) {
      return yield* new ProjectOperationError({
        operation: "dispatch-project-command",
        projectId: input.projectId,
        cause: "Command ID already belongs to another command.",
      });
    }
    const existing = yield* projects.get(input.projectId).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectOperationError({
            operation: "read-project",
            projectId: input.projectId,
            cause,
          }),
      ),
    );
    if (Option.isSome(existing) && existing.value.deletedAt === null) {
      const children = yield* Effect.all([
        projections.listThreadShells("active"),
        projections.listThreadShells("archive"),
      ]).pipe(
        Effect.map((lists) =>
          lists.flat().filter((thread) => thread.projectId === input.projectId),
        ),
        Effect.mapError(
          (cause) =>
            new ProjectOperationError({
              operation: "list-threads",
              projectId: input.projectId,
              cause,
            }),
        ),
      );
      if (children.length > 0 && input.force !== true)
        return yield* new ProjectNotEmptyError({ projectId: input.projectId });
      for (const thread of children) {
        yield* orchestrator
          .dispatch({
            type: "thread.delete",
            commandId: CommandId.make(`${input.commandId}:thread:${thread.id}`),
            threadId: thread.id,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProjectOperationError({
                  operation: "delete-thread",
                  projectId: input.projectId,
                  cause,
                }),
            ),
          );
      }
    }
    yield* commit({
      type: "project.delete",
      commandId: input.commandId,
      projectId: input.projectId,
    });
    const row = yield* projects.get(input.projectId).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectOperationError({
            operation: "read-project",
            projectId: input.projectId,
            cause,
          }),
      ),
    );
    if (Option.isNone(row))
      return yield* new ProjectOperationError({
        operation: "read-project",
        projectId: input.projectId,
        cause: "Project not found.",
      });
    return {
      id: row.value.projectId,
      title: row.value.title,
      workspaceRoot: row.value.workspaceRoot,
      createdAt: row.value.createdAt,
      updatedAt: row.value.updatedAt,
    };
  });

  const update = Effect.fn("ProjectService.update")(function* (input: ProjectUpdatePayload) {
    yield* commit({ type: "project.update", ...input });
    const row = yield* projects.get(input.projectId).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectOperationError({
            operation: "read-project",
            projectId: input.projectId,
            cause,
          }),
      ),
    );
    if (Option.isNone(row))
      return yield* new ProjectOperationError({
        operation: "read-project",
        projectId: input.projectId,
        cause: "Project not found.",
      });
    return {
      id: row.value.projectId,
      title: row.value.title,
      workspaceRoot: row.value.workspaceRoot,
      createdAt: row.value.createdAt,
      updatedAt: row.value.updatedAt,
    };
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

export const layer = Layer.effect(ProjectService, make).pipe(Layer.provide(Orchestrator.layer));

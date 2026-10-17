import type { ApplicationProjectEvent } from "@playstead/contracts/applicationEvent";
import { IsoDateTime, ProjectId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationProjectShell } from "@playstead/contracts/orchestrationProject";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export class ProjectStoreV2Error extends Schema.TaggedError<ProjectStoreV2Error>()(
  "ProjectStoreV2Error",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Project store operation '${this.operation}' failed.`;
  }
}

export const ProjectRow = Schema.Struct({
  projectId: ProjectId,
  title: Schema.String,
  workspaceRoot: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectRow = typeof ProjectRow.Type;

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(ProjectRow));

const toShell = (row: ProjectRow): OrchestrationProjectShell => ({
  id: row.projectId,
  title: row.title,
  workspaceRoot: row.workspaceRoot,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * The project projection, `projection_projects` (T3 Code's
 * `apps/server/src/orchestration-v2/ProjectStore.ts` at 2577baf). The event
 * sink applies each project event to it in the event's own transaction.
 */
export class ProjectStoreV2 extends Context.Service<
  ProjectStoreV2,
  {
    /** Call inside the commit transaction. */
    readonly apply: (event: ApplicationProjectEvent) => Effect.Effect<void, ProjectStoreV2Error>;
    readonly get: (
      projectId: ProjectId,
    ) => Effect.Effect<Option.Option<ProjectRow>, ProjectStoreV2Error>;
    /** Workspace roots match as exact strings; callers normalize first. */
    readonly findByWorkspaceRoot: (
      workspaceRoot: string,
    ) => Effect.Effect<Option.Option<ProjectRow>, ProjectStoreV2Error>;
    readonly getShell: (
      projectId: ProjectId,
    ) => Effect.Effect<Option.Option<OrchestrationProjectShell>, ProjectStoreV2Error>;
    /** Oldest first. */
    readonly listShells: Effect.Effect<
      ReadonlyArray<OrchestrationProjectShell>,
      ProjectStoreV2Error
    >;
  }
>()("@playstead/server/orchestration-v2/ProjectStore/ProjectStoreV2") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const select = (
    operation: string,
    where: {
      readonly projectId?: ProjectId;
      readonly workspaceRoot?: string;
      readonly includeDeleted?: boolean;
    },
  ) =>
    sql`
      SELECT
        project_id AS "projectId",
        title,
        workspace_root AS "workspaceRoot",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
      FROM projection_projects
      WHERE ${sql.and([
        ...(where.includeDeleted ? [] : [sql`deleted_at IS NULL`]),
        ...(where.projectId === undefined ? [] : [sql`project_id = ${where.projectId}`]),
        ...(where.workspaceRoot === undefined
          ? []
          : [sql`workspace_root = ${where.workspaceRoot}`]),
      ])}
      ORDER BY created_at ASC, project_id ASC
    `.pipe(
      Effect.flatMap(decodeRows),
      Effect.mapError((cause) => new ProjectStoreV2Error({ operation, cause })),
    );

  const first = (rows: ReadonlyArray<ProjectRow>) => Option.fromUndefinedOr(rows[0]);

  const get = (projectId: ProjectId) =>
    Effect.map(select("get", { projectId, includeDeleted: true }), first);

  const apply = (event: ApplicationProjectEvent) => {
    switch (event.type) {
      case "project.updated":
        return sql`UPDATE projection_projects SET title = ${event.payload.title}, updated_at = ${event.payload.updatedAt} WHERE project_id = ${event.payload.projectId}`.pipe(
          Effect.asVoid,
          Effect.mapError((cause) => new ProjectStoreV2Error({ operation: "apply", cause })),
        );
      case "project.deleted":
        return sql`UPDATE projection_projects SET deleted_at = ${event.payload.deletedAt}, updated_at = ${event.payload.deletedAt} WHERE project_id = ${event.payload.projectId}`.pipe(
          Effect.asVoid,
          Effect.mapError((cause) => new ProjectStoreV2Error({ operation: "apply", cause })),
        );
      case "project.created": {
        const { payload } = event;
        return sql`
          INSERT INTO projection_projects (
            project_id,
            title,
            workspace_root,
            created_at,
            updated_at
          )
          VALUES (
            ${payload.projectId},
            ${payload.title},
            ${payload.workspaceRoot},
            ${payload.createdAt},
            ${payload.updatedAt}
          )
        `.pipe(
          Effect.asVoid,
          Effect.mapError((cause) => new ProjectStoreV2Error({ operation: "apply", cause })),
        );
      }
    }
  };

  return ProjectStoreV2.of({
    apply,
    get,
    findByWorkspaceRoot: (workspaceRoot) =>
      Effect.map(select("findByWorkspaceRoot", { workspaceRoot }), first),
    getShell: (projectId) =>
      Effect.map(select("getShell", { projectId }), (rows) => Option.map(first(rows), toShell)),
    listShells: Effect.map(select("listShells", {}), (rows) => rows.map(toShell)),
  });
});

export const layer = Layer.effect(ProjectStoreV2, make);

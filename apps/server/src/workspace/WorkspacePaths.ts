import * as HostProcess from "@playstead/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

class WorkspaceRootNotExistsError extends Schema.TaggedError<WorkspaceRootNotExistsError>()(
  "WorkspaceRootNotExistsError",
  { workspaceRoot: Schema.String, normalizedWorkspaceRoot: Schema.String },
) {
  override get message(): string {
    return `The folder ${this.normalizedWorkspaceRoot} does not exist.`;
  }
}

class WorkspaceRootNotDirectoryError extends Schema.TaggedError<WorkspaceRootNotDirectoryError>()(
  "WorkspaceRootNotDirectoryError",
  { workspaceRoot: Schema.String, normalizedWorkspaceRoot: Schema.String },
) {
  override get message(): string {
    return `${this.normalizedWorkspaceRoot} is not a folder.`;
  }
}

class WorkspaceRootCreateFailedError extends Schema.TaggedError<WorkspaceRootCreateFailedError>()(
  "WorkspaceRootCreateFailedError",
  { workspaceRoot: Schema.String, normalizedWorkspaceRoot: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not create the folder ${this.normalizedWorkspaceRoot}.`;
  }
}

class WorkspaceRootStatFailedError extends Schema.TaggedError<WorkspaceRootStatFailedError>()(
  "WorkspaceRootStatFailedError",
  { workspaceRoot: Schema.String, normalizedWorkspaceRoot: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read the folder ${this.normalizedWorkspaceRoot}.`;
  }
}

export type WorkspaceRootError =
  | WorkspaceRootNotExistsError
  | WorkspaceRootNotDirectoryError
  | WorkspaceRootCreateFailedError
  | WorkspaceRootStatFailedError;

/** `~` and `~/…` (or `~\…`) name the home folder; nothing else is expanded. */
export const expandHomePath = (value: string, home: string, path: Path.Path): string => {
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(home, value.slice(2));
  return value;
};

/**
 * Turns a folder path a person typed or picked into a project's workspace
 * root (T3 Code's `apps/server/src/workspace/WorkspacePaths.ts` at 2577baf):
 * trimmed, `~` expanded, resolved to an absolute path, and checked to be an
 * existing folder, made first when asked.
 */
export class WorkspacePaths extends Context.Service<
  WorkspacePaths,
  {
    readonly normalizeWorkspaceRoot: (
      workspaceRoot: string,
      options?: { readonly createIfMissing?: boolean },
    ) => Effect.Effect<string, WorkspaceRootError>;
  }
>()("@playstead/server/workspace/WorkspacePaths") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const statOrNull = (workspaceRoot: string, normalizedWorkspaceRoot: string) =>
    fs.stat(normalizedWorkspaceRoot).pipe(
      Effect.map((info) => info.type),
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(null),
      ),
      Effect.mapError(
        (cause) =>
          new WorkspaceRootStatFailedError({ workspaceRoot, normalizedWorkspaceRoot, cause }),
      ),
    );

  const normalizeWorkspaceRoot = Effect.fn("WorkspacePaths.normalizeWorkspaceRoot")(function* (
    workspaceRoot: string,
    options?: { readonly createIfMissing?: boolean },
  ) {
    const home = yield* HostProcess.HomeDirectory;
    const normalizedWorkspaceRoot = path.resolve(expandHomePath(workspaceRoot.trim(), home, path));
    const fields = { workspaceRoot, normalizedWorkspaceRoot };
    let type = yield* statOrNull(workspaceRoot, normalizedWorkspaceRoot);
    if (type === null && options?.createIfMissing === true) {
      yield* fs
        .makeDirectory(normalizedWorkspaceRoot, { recursive: true })
        .pipe(Effect.mapError((cause) => new WorkspaceRootCreateFailedError({ ...fields, cause })));
      type = yield* statOrNull(workspaceRoot, normalizedWorkspaceRoot);
    }
    if (type === null) return yield* new WorkspaceRootNotExistsError(fields);
    if (type !== "Directory") return yield* new WorkspaceRootNotDirectoryError(fields);
    return normalizedWorkspaceRoot;
  });

  return WorkspacePaths.of({ normalizeWorkspaceRoot });
});

export const layer = Layer.effect(WorkspacePaths, make);

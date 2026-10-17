import {
  ProjectWriteFileError,
  type ProjectWriteFileInput,
  type ProjectWriteFileResult,
} from "@playstead/contracts/project";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/**
 * Writes a file inside a project's folder (T3 Code's
 * `WorkspaceFileSystem.writeFile` and `WorkspacePaths.resolveRelativePathWithinRoot`
 * at 2577baf): the path is relative to the folder, must stay inside it, and
 * its folders are made as needed. The result names the file as a relative
 * path with forward slashes.
 */
export const writeFile = Effect.fn("WorkspaceFiles.writeFile")(function* (
  input: ProjectWriteFileInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const requested = input.relativePath.trim();
  const outside = new ProjectWriteFileError({
    relativePath: input.relativePath,
    message: `${requested} is not inside the project's folder.`,
  });
  if (path.isAbsolute(requested)) return yield* outside;
  const absolutePath = path.resolve(input.cwd, requested);
  const relativePath = path.relative(input.cwd, absolutePath).replaceAll("\\", "/");
  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    path.isAbsolute(relativePath)
  ) {
    return yield* outside;
  }
  const failed = (cause: unknown) =>
    new ProjectWriteFileError({
      relativePath,
      message: `Could not write ${relativePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  yield* fs
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.mapError(failed));
  yield* fs.writeFileString(absolutePath, input.contents).pipe(Effect.mapError(failed));
  return { relativePath } satisfies ProjectWriteFileResult;
});

// @effect-diagnostics nodeBuiltinImport:off -- Effect's FileSystem lists names without their kinds.
import * as NodeFSP from "node:fs/promises";

import {
  FilesystemBrowseError,
  type FilesystemBrowseInput,
  type FilesystemBrowseResult,
} from "@playstead/contracts/filesystem";
import * as HostProcess from "@playstead/shared/hostProcess";
import { isExplicitRelativePath, isWindowsAbsolutePath } from "@playstead/shared/path";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { expandHomePath } from "./WorkspacePaths.ts";

const resolveBrowseTarget = Effect.fn("WorkspaceEntries.resolveBrowseTarget")(function* (
  input: FilesystemBrowseInput,
) {
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const home = yield* HostProcess.HomeDirectory;
  if (platform !== "win32" && isWindowsAbsolutePath(input.partialPath)) {
    return yield* new FilesystemBrowseError({
      partialPath: input.partialPath,
      failure: "windows_path_unsupported",
      detail: `Windows paths such as ${input.partialPath} need a server on Windows.`,
    });
  }
  if (!isExplicitRelativePath(input.partialPath)) {
    return path.resolve(expandHomePath(input.partialPath, home, path));
  }
  if (input.cwd === undefined) {
    return yield* new FilesystemBrowseError({
      partialPath: input.partialPath,
      failure: "current_project_required",
      detail: `A relative path such as ${input.partialPath} needs a folder to start from.`,
    });
  }
  return path.resolve(expandHomePath(input.cwd, home, path), input.partialPath);
});

const isAccessDenied = (cause: unknown) => {
  const code = (cause as NodeJS.ErrnoException | undefined)?.code;
  return code === "EACCES" || code === "EPERM";
};

/**
 * The folders matching a partly typed path, for Add project's autocompletion
 * (T3 Code's `browse` in `apps/server/src/workspace/WorkspaceEntries.ts` at
 * 2577baf). A path ending with a separator, or `~`, lists that folder;
 * otherwise its parent is listed and the last segment filters the names,
 * ignoring case. Hidden folders show only when asked for with a leading `.`
 * or when a whole folder is listed. A folder that may not be read lists
 * nothing.
 */
export const browse = Effect.fn("WorkspaceEntries.browse")(function* (
  input: FilesystemBrowseInput,
): Effect.fn.Return<FilesystemBrowseResult, FilesystemBrowseError, Path.Path> {
  const path = yield* Path.Path;
  const target = yield* resolveBrowseTarget(input);
  const listsWholeFolder = /[\\/]$/.test(input.partialPath) || input.partialPath === "~";
  const parentPath = listsWholeFolder ? target : path.dirname(target);
  const prefix = listsWholeFolder ? "" : path.basename(target);

  const dirents = yield* Effect.tryPromise({
    try: () => NodeFSP.readdir(parentPath, { withFileTypes: true }),
    catch: (cause) => ({ accessDenied: isAccessDenied(cause) }),
  }).pipe(
    Effect.catch((failure) =>
      failure.accessDenied
        ? Effect.succeed([])
        : Effect.fail(
            new FilesystemBrowseError({
              partialPath: input.partialPath,
              failure: "read_directory_failed",
              detail: `Could not read the folder ${parentPath}.`,
            }),
          ),
    ),
  );

  const showHidden = listsWholeFolder || prefix.startsWith(".");
  const lowerPrefix = prefix.toLowerCase();
  const entries = dirents
    .filter(
      (dirent) =>
        dirent.isDirectory() &&
        dirent.name.toLowerCase().startsWith(lowerPrefix) &&
        (showHidden || !dirent.name.startsWith(".")),
    )
    .map((dirent) => ({ name: dirent.name, fullPath: path.join(parentPath, dirent.name) }))
    .toSorted((left, right) => left.name.localeCompare(right.name));

  return { parentPath, entries };
});

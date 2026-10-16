/**
 * A linked Git worktree gets its own Playstead home, `.playstead` at its root
 * (gitignored): work on a branch must not share a database with the main
 * checkout's development server.
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { identity } from "./identity.ts";

/**
 * A worktree's `.git` is a file naming `<common dir>/worktrees/<name>`. The
 * common dir need not be called `.git` (a bare repository's is `<repo>.git`),
 * so only the `worktrees/<name>` tail is matched.
 */
const pointsAtLinkedWorktree = (gitFileContents: string, path: Path.Path): boolean => {
  const gitdir = gitFileContents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("gitdir:"))
    ?.slice("gitdir:".length)
    .trim();
  if (gitdir === undefined || gitdir.length === 0) return false;
  const segments = path
    .normalize(gitdir.replaceAll("\\", "/"))
    .split(/[/\\]/)
    .filter((segment) => segment.length > 0);
  return segments.length >= 3 && segments.at(-2) === "worktrees";
};

/** The root of the linked worktree that holds `cwd`, if it is in one. */
export const resolveGitWorktreePath = (
  cwd: string,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    let directory = path.resolve(cwd);
    for (;;) {
      const info = yield* fs.stat(path.join(directory, ".git")).pipe(Effect.option);
      if (Option.isSome(info)) {
        if (info.value.type !== "File") return undefined;
        const contents = yield* fs
          .readFileString(path.join(directory, ".git"))
          .pipe(Effect.orElseSucceed(() => ""));
        return pointsAtLinkedWorktree(contents, path) ? directory : undefined;
      }
      const parent = path.dirname(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  });

/**
 * The worktree's own home. It need not exist yet: falling back because it is
 * missing would send the server to the shared home.
 */
export const resolveWorktreePlaysteadHome = (cwd: string) =>
  Effect.gen(function* () {
    const worktreePath = yield* resolveGitWorktreePath(cwd);
    if (worktreePath === undefined) return undefined;
    const path = yield* Path.Path;
    return path.join(worktreePath, identity.home.worktreeDirectoryName);
  });

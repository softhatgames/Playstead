import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as PlatformError from "effect/PlatformError";
import * as Schedule from "effect/Schedule";

/** `EBUSY` and `EPERM`: Windows holding a file for a moment after it closes. */
const isHeldByWindows = (error: PlatformError.PlatformError) =>
  error.reason._tag === "Busy" || error.reason._tag === "PermissionDenied";

/**
 * A temporary folder for tests, removed when the scope closes. Close the files
 * and databases in it first. Removal retries only on `EBUSY` and `EPERM`, with
 * a short backoff (about two seconds in all), and a folder that still cannot be
 * removed is left behind rather than failing the test.
 */
export const makeTempDirectoryScoped = (prefix: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* Effect.acquireRelease(fs.makeTempDirectory({ prefix }), (directory) =>
      fs.remove(directory, { recursive: true }).pipe(
        Effect.retry({
          while: isHeldByWindows,
          schedule: Schedule.exponential("10 millis"),
          times: 8,
        }),
        Effect.ignore,
      ),
    );
  });

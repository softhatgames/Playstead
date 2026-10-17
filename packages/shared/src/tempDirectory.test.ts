import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";

import { makeTempDirectoryScoped } from "./tempDirectory.ts";

/**
 * A file system whose removal fails with the given reasons, one per attempt,
 * then succeeds. It records every removal attempt.
 */
const failingRemoval = (failures: ReadonlyArray<PlatformError.SystemErrorTag>) => {
  const attempts: Array<string> = [];
  const layer = FileSystem.layerNoop({
    makeTempDirectory: (options) => Effect.succeed(`/tmp/${options?.prefix ?? ""}1`),
    remove: (path) =>
      Effect.suspend(() => {
        const failure = failures[attempts.length];
        attempts.push(path);
        return failure === undefined
          ? Effect.void
          : Effect.fail(
              PlatformError.systemError({
                _tag: failure,
                module: "FileSystem",
                method: "remove",
                pathOrDescriptor: path,
              }),
            );
      }),
  });
  return { attempts, layer };
};

const useAndRelease = (layer: ReturnType<typeof failingRemoval>["layer"]) =>
  makeTempDirectoryScoped("playstead-test-").pipe(Effect.scoped, Effect.provide(layer));

describe("makeTempDirectoryScoped", () => {
  it.live("removes the folder when the scope closes, retrying while Windows holds it", () =>
    Effect.gen(function* () {
      const { attempts, layer } = failingRemoval(["Busy", "PermissionDenied", "Busy"]);
      const directory = yield* useAndRelease(layer);
      assert.strictEqual(directory, "/tmp/playstead-test-1");
      assert.deepStrictEqual(attempts, Array(4).fill("/tmp/playstead-test-1"));
    }),
  );

  it.live("does not retry a removal that failed for another reason", () =>
    Effect.gen(function* () {
      const { attempts, layer } = failingRemoval(["NotFound", "Busy"]);
      yield* useAndRelease(layer);
      assert.deepStrictEqual(attempts, ["/tmp/playstead-test-1"]);
    }),
  );
});

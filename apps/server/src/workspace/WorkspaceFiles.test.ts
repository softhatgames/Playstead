import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { makeTempHome } from "../testUtils/testServer.ts";
import * as WorkspaceFiles from "./WorkspaceFiles.ts";

describe("WorkspaceFiles.writeFile", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("writes a file inside the project, making its folders", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* makeTempHome;

        const result = yield* WorkspaceFiles.writeFile({
          cwd: root,
          relativePath: "plans/write-hello.md",
          contents: "# Write hello\n",
        });

        assert.strictEqual(result.relativePath, "plans/write-hello.md");
        assert.strictEqual(
          yield* fs.readFileString(path.join(root, "plans", "write-hello.md")),
          "# Write hello\n",
        );
      }).pipe(Effect.scoped),
    );

    it.effect("refuses a path that leaves the project", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = path.join(yield* makeTempHome, "game");
        yield* fs.makeDirectory(root);

        const refused = yield* Effect.flip(
          WorkspaceFiles.writeFile({ cwd: root, relativePath: "../outside.md", contents: "x" }),
        );

        assert.strictEqual(refused.message, "../outside.md is not inside the project's folder.");
        assert.isFalse(yield* fs.exists(path.join(root, "..", "outside.md")));
      }).pipe(Effect.scoped),
    );

    it.effect("refuses an absolute path", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const root = yield* makeTempHome;
        const absolute = path.resolve(path.sep, "elsewhere", "plan.md");

        const refused = yield* Effect.flip(
          WorkspaceFiles.writeFile({ cwd: root, relativePath: absolute, contents: "x" }),
        );

        assert.strictEqual(refused.message, `${absolute} is not inside the project's folder.`);
      }).pipe(Effect.scoped),
    );
  });
});

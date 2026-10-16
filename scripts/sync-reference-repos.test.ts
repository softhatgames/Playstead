import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { planReferenceRepoSync } from "./sync-reference-repos.ts";

const workspaceWithEffect = (version: string) => `packages:
  - packages/*

catalog:
  effect: ${version}
  vite-plus: 1.0.0
`;

const makeRoot = Effect.fn("makeRoot")(function* (version: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "playstead-sync-repos-" });
  yield* fs.writeFileString(path.join(root, "pnpm-workspace.yaml"), workspaceWithEffect(version));
  return root;
});

describe("planReferenceRepoSync", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("adds Effect's source at the version the catalog pins", () =>
      Effect.gen(function* () {
        const root = yield* makeRoot("4.0.5");
        const [plan, ...rest] = yield* planReferenceRepoSync({ rootDir: root });
        assert.strictEqual(rest.length, 0);
        assert.deepStrictEqual(plan?.args, [
          "subtree",
          "add",
          "--prefix=.repos/effect-smol",
          "https://github.com/Effect-TS/effect.git",
          "effect@4.0.5",
          "--squash",
        ]);
      }).pipe(Effect.scoped),
    );

    it.effect("pulls into a vendored copy that is already there", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* makeRoot("4.0.7");
        yield* fs.makeDirectory(path.join(root, ".repos", "effect-smol"), { recursive: true });
        const [plan] = yield* planReferenceRepoSync({ rootDir: root });
        assert.strictEqual(plan?.args[1], "pull");
        assert.strictEqual(plan?.args[4], "effect@4.0.7");
      }).pipe(Effect.scoped),
    );

    it.effect("fails when the catalog does not pin Effect", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* makeRoot("4.0.5");
        yield* fs.writeFileString(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
        const error = yield* Effect.flip(planReferenceRepoSync({ rootDir: root }));
        assert.strictEqual(error._tag, "ReferenceRepoVersionError");
      }).pipe(Effect.scoped),
    );
  });
});

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@playstead/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { makeTempHome } from "../testUtils/testServer.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";

/** A home folder with a few folders, a hidden one and a file. */
const makeHome = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* makeTempHome;
  for (const name of ["games", "Gadgets", "music", ".config"]) {
    yield* fs.makeDirectory(path.join(home, name));
  }
  yield* fs.writeFileString(path.join(home, "game-notes.txt"), "a file, not a folder");
  return home;
});

const browse = (input: { readonly partialPath: string; readonly cwd?: string }, home: string) =>
  WorkspaceEntries.browse(input).pipe(Effect.provideService(HostProcess.HomeDirectory, home));

const names = (result: { readonly entries: ReadonlyArray<{ readonly name: string }> }) =>
  result.entries.map((entry) => entry.name);

describe("WorkspaceEntries.browse", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("lists the folders in a path that ends with a separator", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeHome;

        const result = yield* browse({ partialPath: `${home}${path.sep}` }, home);

        assert.strictEqual(result.parentPath, home);
        assert.deepStrictEqual(names(result), [".config", "Gadgets", "games", "music"]);
        assert.deepStrictEqual(
          result.entries.map((entry) => entry.fullPath),
          [".config", "Gadgets", "games", "music"].map((name) => path.join(home, name)),
        );
      }).pipe(Effect.scoped),
    );

    it.effect("completes a partly typed name, ignoring case, without hidden folders", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeHome;

        const result = yield* browse({ partialPath: path.join(home, "ga") }, home);

        assert.strictEqual(result.parentPath, home);
        assert.deepStrictEqual(names(result), ["Gadgets", "games"]);
        const hidden = yield* browse({ partialPath: path.join(home, ".c") }, home);
        assert.deepStrictEqual(names(hidden), [".config"]);
      }).pipe(Effect.scoped),
    );

    it.effect("starts from the home folder for ~ and ~/", () =>
      Effect.gen(function* () {
        const home = yield* makeHome;

        const bare = yield* browse({ partialPath: "~" }, home);
        const slash = yield* browse({ partialPath: "~/mu" }, home);

        assert.strictEqual(bare.parentPath, home);
        assert.deepStrictEqual(names(bare), [".config", "Gadgets", "games", "music"]);
        assert.deepStrictEqual(names(slash), ["music"]);
      }).pipe(Effect.scoped),
    );

    it.effect("resolves a relative path only against a folder it is given", () =>
      Effect.gen(function* () {
        const home = yield* makeHome;

        const refused = yield* Effect.flip(browse({ partialPath: "./g" }, home));
        const resolved = yield* browse({ partialPath: "./g", cwd: home }, home);

        assert.strictEqual(refused.failure, "current_project_required");
        assert.deepStrictEqual(names(resolved), ["Gadgets", "games"]);
      }).pipe(Effect.scoped),
    );

    it.effect("refuses a Windows path on another platform", () =>
      Effect.gen(function* () {
        const home = yield* makeHome;

        const error = yield* Effect.flip(
          browse({ partialPath: "C:\\Users\\" }, home).pipe(
            Effect.provideService(HostProcess.Platform, "darwin"),
          ),
        );

        assert.strictEqual(error.failure, "windows_path_unsupported");
      }).pipe(Effect.scoped),
    );

    it.effect("fails for a folder that does not exist", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeHome;

        const error = yield* Effect.flip(
          browse({ partialPath: `${path.join(home, "missing")}${path.sep}` }, home),
        );

        assert.strictEqual(error.failure, "read_directory_failed");
      }).pipe(Effect.scoped),
    );
  });
});

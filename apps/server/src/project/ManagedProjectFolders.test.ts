import * as PlatformError from "effect/PlatformError";
import { CommandId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as FileSystem from "effect/FileSystem";
import * as ServerConfig from "../config.ts";
import * as Runtime from "../orchestration-v2/runtimeLayer.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import { makeTestServerConfig } from "../testUtils/testServer.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as Projects from "./ProjectService.ts";
import * as Managed from "./ManagedProjectFolders.ts";

const start = (config: ServerConfig.ServerConfig["Service"]) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      Managed.layer.pipe(
        Layer.provideMerge(Projects.layer.pipe(Layer.provide(WorkspacePaths.layer))),
        Layer.provide(Runtime.layer),
        Layer.provide(Sqlite.layerConfig),
        Layer.provide(ServerConfig.layer(config)),
      ),
    );
    return {
      home: config.baseDir,
      folders: yield* Managed.ManagedProjectFolders.pipe(Effect.provideContext(context)),
      projects: yield* Projects.ProjectService.pipe(Effect.provideContext(context)),
    };
  });

describe("managed scratch folders", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("offers scratch when Git is missing", () =>
      Effect.gen(function* () {
        const missing = ChildProcessSpawner.make(() =>
          Effect.fail(
            PlatformError.systemError({
              _tag: "NotFound",
              module: "ChildProcess",
              method: "spawn",
              pathOrDescriptor: "git",
            }),
          ),
        );
        const { folders } = yield* start(yield* makeTestServerConfig()).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, missing),
        );
        assert.isTrue(Option.isSome(yield* folders.scratchRoot));
      }).pipe(Effect.scoped),
    );
    it.effect(
      "names distinct thread folders from the first message and preserves existing files",
      () =>
        Effect.gen(function* () {
          const { folders } = yield* start(yield* makeTestServerConfig());
          const { projectId } = yield* folders.ensureScratchProject;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const input = {
            projectId,
            threadId: ThreadId.make("thread:12345678"),
            text: "Build a cozy frog bakery! More words",
          };
          const first = Option.getOrThrow(yield* folders.folderForThread(input));
          assert.match(
            path.basename(first),
            /^\d{4}-\d{2}-\d{2}-build-a-cozy-frog-bakery-12345678$/,
          );
          yield* fs.writeFileString(path.join(first, "keep.txt"), "mine");
          const second = Option.getOrThrow(yield* folders.folderForThread(input));
          assert.notStrictEqual(second, first);
          assert.strictEqual(yield* fs.readFileString(path.join(first, "keep.txt")), "mine");
        }).pipe(Effect.scoped),
    );
    it.effect("recreates the scratch root and never allocates folders for ordinary projects", () =>
      Effect.gen(function* () {
        const { folders, projects, home } = yield* start(yield* makeTestServerConfig());
        const first = yield* folders.ensureScratchProject;
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const root = path.join(home, "scratch");
        yield* fs.remove(root, { recursive: true });
        assert.deepStrictEqual(yield* folders.ensureScratchProject, first);
        assert.isTrue(yield* fs.exists(root));
        const ordinary = yield* projects.create({
          commandId: CommandId.make("ordinary"),
          projectId: ProjectId.make("ordinary"),
          title: "Game",
          workspaceRoot: path.join(home, "game"),
          createWorkspaceRootIfMissing: true,
        });
        assert.deepStrictEqual(
          yield* folders.folderForThread({
            projectId: ordinary.id,
            threadId: ThreadId.make("thread:ordinary"),
            text: "Hello",
          }),
          Option.none(),
        );
        assert.deepStrictEqual(yield* fs.readDirectory(ordinary.workspaceRoot), []);
      }).pipe(Effect.scoped),
    );
    it.effect(
      "uses safe bounded names for punctuation, non-Latin messages and repeated collisions",
      () =>
        Effect.gen(function* () {
          const { folders } = yield* start(yield* makeTestServerConfig());
          const { projectId } = yield* folders.ensureScratchProject;
          const path = yield* Path.Path;
          const input = {
            projectId,
            threadId: ThreadId.make("thread:12345678"),
            text: "../你好 🐸 :*?",
          };
          const names = yield* Effect.all(
            Array.from({ length: 3 }, () => folders.folderForThread(input)),
            { concurrency: "unbounded" },
          );
          assert.strictEqual(new Set(names.map((name) => Option.getOrThrow(name))).size, 3);
          assert.isTrue(
            names.some((name) => path.basename(Option.getOrThrow(name)) === "1970-01-01-12345678"),
          );
          assert.isTrue(
            names.some(
              (name) => path.basename(Option.getOrThrow(name)) === "1970-01-01-thread12345678",
            ),
          );
          const long = Option.getOrThrow(
            yield* folders.folderForThread({ ...input, text: "a".repeat(200) }),
          );
          assert.strictEqual(path.basename(long), `1970-01-01-${"a".repeat(48)}-12345678`);
        }).pipe(Effect.scoped),
    );
    it.effect("does not offer scratch when the home is inside a Git checkout", () =>
      Effect.gen(function* () {
        const config = yield* makeTestServerConfig();
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        yield* spawner.exitCode(ChildProcess.make("git", ["init", config.baseDir]));
        const { folders } = yield* start(config);
        assert.deepStrictEqual(yield* folders.scratchRoot, Option.none());
        assert.strictEqual((yield* Effect.flip(folders.ensureScratchProject))._tag, "ScratchError");
      }).pipe(Effect.scoped),
    );
    it.effect("offers scratch outside Git and creates one project on concurrent first use", () =>
      Effect.gen(function* () {
        const { folders, projects, home } = yield* start(yield* makeTestServerConfig());
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const root = path.join(home, "scratch");
        assert.deepStrictEqual(yield* folders.scratchRoot, Option.some(root));
        assert.isFalse(yield* fs.exists(root));
        const results = yield* Effect.all(
          Array.from({ length: 8 }, () => folders.ensureScratchProject),
          { concurrency: "unbounded" },
        );
        assert.strictEqual(new Set(results.map((r) => r.projectId)).size, 1);
        const list = yield* projects.listShells;
        assert.strictEqual(list.length, 1);
        assert.strictEqual(list[0]?.title, "No project");
        assert.strictEqual(list[0]?.workspaceRoot, root);
      }).pipe(Effect.scoped),
    );
  });
});

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, ProjectId } from "@playstead/contracts/baseSchemas";
import { ProjectConflictError } from "@playstead/contracts/project";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as HostProcess from "@playstead/shared/hostProcess";

import * as ServerConfig from "../config.ts";
import * as OrchestrationRuntime from "../orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { makeTestServerConfig } from "../testUtils/testServer.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProjectService from "./ProjectService.ts";

/**
 * The project service over the real event sink, project projection and
 * SQLite, in a temporary Playstead home whose folders stand in for the
 * person's.
 */
const startProjects = Effect.gen(function* () {
  const config = yield* makeTestServerConfig();
  const context = yield* Layer.build(
    Layer.mergeAll(ProjectService.layer, Orchestrator.layer).pipe(
      Layer.provide(ProviderAdapterRegistry.layerFromAdapters([])),
      Layer.provide(OrchestrationRuntime.layer),
      Layer.provide(WorkspacePaths.layer),
      Layer.provide(SqlitePersistence.layerConfig),
      Layer.provide(ServerConfig.layer(config)),
    ),
  );
  const projects = yield* ProjectService.ProjectService.pipe(Effect.provideContext(context));
  const orchestrator = yield* Orchestrator.OrchestratorV2.pipe(Effect.provideContext(context));
  return {
    projects: {
      ...projects,
      delete: (input: Parameters<typeof projects.delete>[0]) =>
        projects
          .delete(input)
          .pipe(Effect.provideService(Orchestrator.OrchestratorV2, orchestrator)),
    },
    home: config.baseDir,
  };
});

const createInput = (
  name: string,
  workspaceRoot: string,
  extra?: { readonly createWorkspaceRootIfMissing?: boolean },
) => ({
  commandId: CommandId.make(`command:${name}`),
  projectId: ProjectId.make(`project:${name}`),
  title: name,
  workspaceRoot,
  ...extra,
});

describe("ProjectService", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "removes an empty project without touching files and permits adding its folder again",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const { projects, home } = yield* startProjects;
          const folder = path.join(home, "removed-game");
          yield* fs.makeDirectory(folder);
          const file = path.join(folder, "game.txt");
          yield* fs.writeFileString(file, "keep my game");
          const first = yield* projects.create(createInput("original", folder));
          const deletion = { commandId: CommandId.make("command:remove"), projectId: first.id };
          yield* projects.delete(deletion);
          yield* projects.delete(deletion);
          assert.deepStrictEqual(yield* projects.listShells, []);
          assert.strictEqual((yield* projects.getShell(first.id))._tag, "None");
          assert.strictEqual(yield* fs.readFileString(file), "keep my game");
          const added = yield* projects.create(createInput("added-again", folder));
          assert.notStrictEqual(added.id, first.id);
          assert.deepStrictEqual(
            (yield* projects.listShells).map((p) => p.id),
            [added.id],
          );
        }).pipe(Effect.scoped),
    );

    it.effect("makes an empty folder a project and lists it", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { projects, home } = yield* startProjects;
        const folder = path.join(home, "empty-game");
        yield* fs.makeDirectory(folder);

        const project = yield* projects.create(createInput("empty-game", folder));

        assert.strictEqual(project.id, "project:empty-game");
        assert.strictEqual(project.title, "empty-game");
        assert.strictEqual(project.workspaceRoot, folder);
        const listed = yield* projects.listShells;
        assert.deepStrictEqual(
          listed.map((shell) => [shell.id, shell.workspaceRoot]),
          [["project:empty-game", folder]],
        );
      }).pipe(Effect.scoped),
    );

    it.effect("refuses a second project for a folder that already has one", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { projects, home } = yield* startProjects;
        const folder = path.join(home, "owned");
        yield* fs.makeDirectory(folder);
        yield* projects.create(createInput("first", folder));

        // The same folder, spelled with a trailing separator.
        const error = yield* Effect.flip(
          projects.create(createInput("second", `${folder}${path.sep}`)),
        );

        assert.deepStrictEqual(
          error,
          new ProjectConflictError({
            projectId: ProjectId.make("project:second"),
            workspaceRoot: folder,
            conflictingProjectId: ProjectId.make("project:first"),
          }),
        );
        const listed = yield* projects.listShells;
        assert.deepStrictEqual(
          listed.map((shell) => shell.id),
          ["project:first"],
        );
      }).pipe(Effect.scoped),
    );

    it.effect("makes a missing folder when asked, and refuses one otherwise", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { projects, home } = yield* startProjects;
        const folder = path.join(home, "new-game", "nested");

        const refused = yield* Effect.flip(projects.create(createInput("refused", folder)));
        assert.strictEqual(refused._tag, "ProjectOperationError");
        assert.isFalse(yield* fs.exists(folder));

        const project = yield* projects.create(
          createInput("made", folder, { createWorkspaceRootIfMissing: true }),
        );
        assert.strictEqual(project.workspaceRoot, folder);
        assert.strictEqual((yield* fs.stat(folder)).type, "Directory");
        const listed = yield* projects.listShells;
        assert.deepStrictEqual(
          listed.map((shell) => shell.id),
          ["project:made"],
        );
      }).pipe(Effect.scoped),
    );

    it.effect("refuses a path that is a file", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { projects, home } = yield* startProjects;
        const file = path.join(home, "notes.txt");
        yield* fs.writeFileString(file, "not a folder");

        const error = yield* Effect.flip(
          projects.create(createInput("file", file, { createWorkspaceRootIfMissing: true })),
        );

        assert.strictEqual(error._tag, "ProjectOperationError");
        assert.deepStrictEqual(yield* projects.listShells, []);
      }).pipe(Effect.scoped),
    );

    it.effect("expands ~ to the home folder", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const { projects, home } = yield* startProjects;

        const project = yield* projects
          .create(createInput("tilde", "~/games/tilde", { createWorkspaceRootIfMissing: true }))
          .pipe(Effect.provideService(HostProcess.HomeDirectory, home));

        assert.strictEqual(project.workspaceRoot, path.join(home, "games", "tilde"));
      }).pipe(Effect.scoped),
    );

    it.effect("gives a retried command its first outcome", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { projects, home } = yield* startProjects;
        const folder = path.join(home, "retried");
        yield* fs.makeDirectory(folder);

        const first = yield* projects.create(createInput("retried", folder));
        const again = yield* projects.create(createInput("retried", folder));
        assert.deepStrictEqual(again, first);

        const conflict = yield* Effect.flip(projects.create(createInput("late", folder)));
        const conflictAgain = yield* Effect.flip(projects.create(createInput("late", folder)));
        assert.strictEqual(conflict._tag, "ProjectConflictError");
        assert.deepStrictEqual(conflictAgain, conflict);
        const listed = yield* projects.listShells;
        assert.deepStrictEqual(
          listed.map((shell) => shell.id),
          ["project:retried"],
        );
      }).pipe(Effect.scoped),
    );
  });
});

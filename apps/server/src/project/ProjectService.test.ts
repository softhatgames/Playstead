import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, ProjectId } from "@playstead/contracts/baseSchemas";
import { ProjectConflictError } from "@playstead/contracts/project";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HostProcess from "@playstead/shared/hostProcess";

import { makeOrchestrationHarness } from "../orchestration-v2/testkit/OrchestratorHarness.ts";

/**
 * The project service over the real event sink, orchestrator, projections
 * and SQLite, in a temporary Playstead home whose folders stand in for the
 * person's.
 */
const startProjects = Effect.map(makeOrchestrationHarness({}), (harness) => ({
  projects: harness.projects,
  home: harness.home,
}));

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

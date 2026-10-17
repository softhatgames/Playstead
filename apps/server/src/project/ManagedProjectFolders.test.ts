import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import { removeTempDirectory } from "@playstead/shared/tempDirectory";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/process";

import { makeOrchestrationHarness } from "../orchestration-v2/testkit/OrchestratorHarness.ts";
import { makeHomeInsideGitCheckout, makeTestServerConfig } from "../testUtils/testServer.ts";

/**
 * Threads without a project (T3 Code's `ManagedProjectFolders.test.ts` at
 * 2577baf, its Scratch cases): the managed folders and the project service
 * over the real stores, in a temporary Playstead home, with the real Git
 * unless a test says otherwise.
 */

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

const requireRoot = (harness: Harness) =>
  Effect.map(harness.folders.scratchRoot, Option.getOrThrow);

describe("ManagedProjectFolders", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("offers a scratch folder under the home when it is outside a Git checkout", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const harness = yield* makeOrchestrationHarness({});
        assert.strictEqual(yield* requireRoot(harness), path.resolve(harness.home, "scratch"));
      }).pipe(Effect.scoped),
    );

    it.effect("offers nothing when the home is inside a Git checkout", () =>
      Effect.gen(function* () {
        const home = yield* makeHomeInsideGitCheckout;
        const harness = yield* makeOrchestrationHarness({
          config: yield* makeTestServerConfig({ home }),
        });

        assert.isTrue(Option.isNone(yield* harness.folders.scratchRoot));
        const failure = yield* Effect.flip(harness.projects.ensureScratchProject);
        assert.strictEqual(failure._tag, "ScratchUnavailableError");
        assert.deepStrictEqual(yield* harness.projects.listShells, []);
      }).pipe(Effect.scoped),
    );

    it.effect("offers a scratch folder when Git is not installed", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const missingGit = ChildProcessSpawner.make(() =>
          Effect.fail(
            PlatformError.systemError({
              _tag: "NotFound",
              module: "ChildProcess",
              method: "spawn",
              syscall: "spawn git",
            }),
          ),
        );
        const harness = yield* makeOrchestrationHarness({ childProcessSpawner: missingGit });
        assert.strictEqual(yield* requireRoot(harness), path.resolve(harness.home, "scratch"));
      }).pipe(Effect.scoped),
    );

    it.effect("creates one No project project, even for concurrent first requests", () =>
      Effect.gen(function* () {
        const harness = yield* makeOrchestrationHarness({});
        const racers = yield* Effect.all(
          Array.from({ length: 8 }, () => harness.projects.ensureScratchProject),
          { concurrency: "unbounded" },
        );
        const again = yield* harness.projects.ensureScratchProject;

        assert.deepStrictEqual(
          new Set(racers.map((result) => result.projectId)),
          new Set([again.projectId]),
        );
        const root = yield* requireRoot(harness);
        const listed = yield* harness.projects.listShells;
        assert.deepStrictEqual(
          listed.map((project) => [project.id, project.title, project.workspaceRoot]),
          [[again.projectId, "No project", root]],
        );
      }).pipe(Effect.scoped),
    );

    it.effect("removes and recreates the managed entry while keeping its files", () =>
      Effect.gen(function* () {
        const harness = yield* makeOrchestrationHarness({});
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const first = yield* harness.projects.ensureScratchProject;
        const root = yield* requireRoot(harness);
        const file = path.join(root, "keep.txt");
        yield* fs.writeFileString(file, "kept");
        yield* harness.projects.delete({
          commandId: CommandId.make("remove-scratch"),
          projectId: first.projectId,
          force: true,
        });
        const second = yield* harness.projects.ensureScratchProject;
        assert.notStrictEqual(second.projectId, first.projectId);
        assert.strictEqual(yield* fs.readFileString(file), "kept");
      }).pipe(Effect.scoped),
    );

    it.effect("makes the scratch folder again after it is deleted", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const harness = yield* makeOrchestrationHarness({});
        const { projectId } = yield* harness.projects.ensureScratchProject;
        const root = yield* requireRoot(harness);
        yield* removeTempDirectory(root);

        assert.strictEqual((yield* harness.projects.ensureScratchProject).projectId, projectId);
        assert.isTrue(yield* fs.exists(root));

        yield* removeTempDirectory(root);
        const folder = yield* harness.folders.folderForThread({
          projectId,
          threadId: ThreadId.make("thread-after-delete"),
          text: "Still works",
        });
        assert.isTrue(yield* fs.exists(Option.getOrThrow(folder)));
      }).pipe(Effect.scoped),
    );

    it.effect("gives each thread its own folder, named from its first message", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const harness = yield* makeOrchestrationHarness({});
        const { projectId } = yield* harness.projects.ensureScratchProject;
        const root = yield* requireRoot(harness);
        const text = "Convert these PNGs to WebP, please!";
        const claim = (threadId: string, message = text) =>
          Effect.map(
            harness.folders.folderForThread({
              projectId,
              threadId: ThreadId.make(threadId),
              text: message,
            }),
            Option.getOrThrow,
          );

        // The first two ids end alike, so the second falls back to its whole id.
        const first = yield* claim("thread:a:0123456789abcdef");
        const second = yield* claim("thread:b:0123456789abcdef");
        const third = yield* claim("thread:b0123456789abcdef");

        // The test clock starts at the epoch. The third id, without its
        // punctuation, is the second's, so it takes a random suffix.
        assert.deepStrictEqual(
          [first, second].map((folder) => path.relative(root, folder)),
          [
            "1970-01-01-convert-these-pngs-to-webp-89abcdef",
            "1970-01-01-convert-these-pngs-to-webp-threadb0123456789abcdef",
          ],
        );
        assert.strictEqual(path.dirname(third), root);
        assert.match(
          path.basename(third),
          /^1970-01-01-convert-these-pngs-to-webp-threadb0123456789abcdef-[0-9a-f]{8}$/,
        );
        for (const folder of [first, second, third]) {
          assert.isTrue(yield* fs.exists(folder));
        }

        const pasted = yield* claim("thread-pasted", `${"word ".repeat(10_000)}../../etc`);
        assert.strictEqual(path.dirname(pasted), root);
        assert.isAtMost(path.basename(pasted).length, 80);
      }).pipe(Effect.scoped),
    );

    it.effect("leaves threads of other projects alone", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const harness = yield* makeOrchestrationHarness({});
        yield* harness.projects.ensureScratchProject;
        const other = yield* harness.projects.create({
          commandId: CommandId.make("command:other"),
          projectId: ProjectId.make("project:other"),
          title: "Other",
          workspaceRoot: path.join(harness.home, "other"),
          createWorkspaceRootIfMissing: true,
        });

        const folder = yield* harness.folders.folderForThread({
          projectId: other.id,
          threadId: ThreadId.make("thread-other"),
          text: "Hello",
        });
        assert.isTrue(Option.isNone(folder));
        assert.deepStrictEqual(yield* fs.readDirectory(yield* requireRoot(harness)), []);
      }).pipe(Effect.scoped),
    );
  });
});

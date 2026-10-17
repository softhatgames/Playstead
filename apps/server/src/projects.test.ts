import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { makeLocalConnection } from "@playstead/client-runtime/connection";
import { CommandId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { ProjectMutation } from "@playstead/contracts/project";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { awaitConnectionState, connectSignedIn } from "./testUtils/testClient.ts";
import { startTestServer } from "./testUtils/testServer.ts";

/**
 * Add project over the RPC contract, as the interface does it: browse for the
 * folder, create the project, and see it in the sidebar's shell.
 */
describe("project RPC methods", () => {
  it.layer(
    Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, NodeSocket.layerWebSocketConstructor),
    { excludeTestServices: true },
  )((it) => {
    it.effect("adds a browsed folder as a project that every client's shell shows", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const server = yield* startTestServer();
        const folder = path.join(server.config.baseDir, "My Game");
        yield* fs.makeDirectory(folder);
        const { connection, cookie } = yield* connectSignedIn(server);
        const initial = yield* awaitConnectionState(
          connection,
          (state) => state.shell !== undefined,
        );
        assert.deepStrictEqual(initial.shell?.projects, []);

        const browsed = yield* connection.request((client) =>
          client["filesystem.browse"]({ partialPath: path.join(server.config.baseDir, "my") }),
        );
        assert.deepStrictEqual(browsed.entries, [{ name: "My Game", fullPath: folder }]);

        const project = yield* connection.request((client) =>
          client["projects.mutate"]({
            type: "project.create",
            commandId: CommandId.make("command:add-my-game"),
            projectId: ProjectId.make("project:my-game"),
            title: "My Game",
            workspaceRoot: browsed.entries[0]!.fullPath,
            createWorkspaceRootIfMissing: true,
          }),
        );
        assert.strictEqual(project.workspaceRoot, folder);

        const live = yield* awaitConnectionState(
          connection,
          (state) => (state.shell?.projects.length ?? 0) > 0,
        );
        assert.deepStrictEqual(
          live.shell?.projects.map((shell) => [shell.id, shell.title, shell.workspaceRoot]),
          [["project:my-game", "My Game", folder]],
        );

        const second = yield* makeLocalConnection({
          httpBaseUrl: server.baseUrl,
          credential: { _tag: "BrowserCookie" },
          socketHeaders: { cookie },
        });
        const snapshot = yield* awaitConnectionState(second, (state) => state.shell !== undefined);
        assert.deepStrictEqual(
          snapshot.shell?.projects.map((shell) => shell.id),
          ["project:my-game"],
        );
      }).pipe(Effect.scoped),
    );

    it.effect("answers a second project for the same folder with the project that owns it", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const server = yield* startTestServer();
        const folder = path.join(server.config.baseDir, "owned");
        yield* fs.makeDirectory(folder);
        const { connection } = yield* connectSignedIn(server);
        const create = (name: string) =>
          connection.request((client) =>
            client["projects.mutate"]({
              type: "project.create",
              commandId: CommandId.make(`command:${name}`),
              projectId: ProjectId.make(`project:${name}`),
              title: name,
              workspaceRoot: folder,
            }),
          );
        yield* create("first");

        const error = yield* Effect.flip(create("second"));

        assert.strictEqual(error._tag, "ProjectConflictError");
        assert.strictEqual(
          error._tag === "ProjectConflictError" ? error.conflictingProjectId : undefined,
          "project:first",
        );
      }).pipe(Effect.scoped),
    );

    it.effect(
      "renames a project and removes it with its thread, which the shell drops, leaving the folder",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const server = yield* startTestServer();
          const folder = path.join(server.config.baseDir, "space-game");
          yield* fs.makeDirectory(folder);
          const { connection } = yield* connectSignedIn(server);
          const projectId = ProjectId.make("project:space-game");
          const threadId = ThreadId.make("thread:space-game");
          const mutate = (mutation: ProjectMutation) =>
            connection.request((client) => client["projects.mutate"](mutation));
          yield* mutate({
            type: "project.create",
            commandId: CommandId.make("command:create"),
            projectId,
            title: "space-game",
            workspaceRoot: folder,
          });
          yield* connection.request((client) =>
            client["orchestration.dispatchCommand"]({
              type: "thread.create",
              commandId: CommandId.make("command:create-thread"),
              threadId,
              projectId,
              title: "New thread",
              modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
            }),
          );

          const renamed = yield* mutate({
            type: "project.update",
            commandId: CommandId.make("command:rename"),
            projectId,
            title: "Moon Jumper",
          });
          assert.strictEqual(renamed.title, "Moon Jumper");
          yield* awaitConnectionState(connection, (state) =>
            (state.shell?.projects ?? []).some((project) => project.title === "Moon Jumper"),
          );

          const refused = yield* Effect.flip(
            mutate({
              type: "project.delete",
              commandId: CommandId.make("command:remove"),
              projectId,
            }),
          );
          assert.strictEqual(refused._tag, "ProjectMutationError");
          assert.strictEqual(refused.message, `Project ${projectId} is not empty.`);

          yield* mutate({
            type: "project.delete",
            commandId: CommandId.make("command:remove-anyway"),
            projectId,
            force: true,
          });
          const after = yield* awaitConnectionState(
            connection,
            (state) => state.shell !== undefined && state.shell.projects.length === 0,
          );
          assert.deepStrictEqual(after.shell?.threads, []);
          assert.strictEqual((yield* fs.stat(folder)).type, "Directory");
        }).pipe(Effect.scoped),
    );
  });
});

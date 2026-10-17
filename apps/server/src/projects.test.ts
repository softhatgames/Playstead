import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { makeLocalConnection } from "@playstead/client-runtime/connection";
import { CommandId, ProjectId } from "@playstead/contracts/baseSchemas";
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
    it.effect("advertises scratch and ensures one project over RPC", () =>
      Effect.gen(function* () {
        const server = yield* startTestServer();
        const { connection } = yield* connectSignedIn(server);
        const config = yield* connection.request((client) => client["server.getConfig"]({}));
        assert.strictEqual(
          config.scratchWorkspaceRoot,
          (yield* Path.Path).join(server.config.baseDir, "scratch"),
        );
        const result = yield* connection.request((client) => client["projects.ensureScratch"]({}));
        const state = yield* awaitConnectionState(
          connection,
          (state) => state.shell?.projects.some((p) => p.id === result.projectId) === true,
        );
        assert.strictEqual(state.shell?.projects[0]?.title, "No project");
      }).pipe(Effect.scoped),
    );
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
  });
});

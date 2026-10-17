import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { awaitConnectionState, connectSignedIn } from "./testUtils/testClient.ts";
import { makeTestServerConfig, startTestServer } from "./testUtils/testServer.ts";

/**
 * The server's settings over the RPC contract, as **Settings → General**
 * uses them: the default permissions for new threads.
 */
describe("server settings", () => {
  it.layer(
    Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, NodeSocket.layerWebSocketConstructor),
    { excludeTestServices: true },
  )((it) => {
    it.effect("saves the default permissions for new threads and sends them to every client", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const server = yield* startTestServer();
        const { connection } = yield* connectSignedIn(server);
        const initial = yield* awaitConnectionState(
          connection,
          (state) => state.config !== undefined,
        );
        assert.strictEqual(initial.config?.settings.defaultRuntimeMode, "full-access");

        const settings = yield* connection.request((client) =>
          client["server.updateSettings"]({ patch: { defaultRuntimeMode: "auto" } }),
        );
        assert.deepStrictEqual(settings, { providerInstances: {}, defaultRuntimeMode: "auto" });

        const updated = yield* awaitConnectionState(
          connection,
          (state) => state.config?.settings.defaultRuntimeMode === "auto",
        );
        assert.deepStrictEqual(updated.config?.settings, settings);
        const saved = yield* fs.readFileString(server.config.settingsPath);
        assert.deepStrictEqual(JSON.parse(saved), settings);
      }).pipe(Effect.scoped),
    );

    it.effect("keeps the default permissions when a Binary path is saved", () =>
      Effect.gen(function* () {
        const server = yield* startTestServer();
        const { connection } = yield* connectSignedIn(server);
        yield* connection.request((client) =>
          client["server.updateSettings"]({ patch: { defaultRuntimeMode: "auto" } }),
        );

        const settings = yield* connection.request((client) =>
          client["server.updateSettings"]({
            patch: {},
            providerInstanceMutation: {
              operation: "upsert",
              instanceId: "codex",
              instance: { driver: "codex", config: { binaryPath: "my-codex" } },
            },
          }),
        );

        assert.deepStrictEqual(settings, {
          providerInstances: { codex: { driver: "codex", config: { binaryPath: "my-codex" } } },
          defaultRuntimeMode: "auto",
        });
      }).pipe(Effect.scoped),
    );

    it.effect("keeps full access for settings saved before a default was configured", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* makeTestServerConfig();
        yield* fs.makeDirectory(path.dirname(config.settingsPath), { recursive: true });
        yield* fs.writeFileString(
          config.settingsPath,
          JSON.stringify({
            providerInstances: { codex: { driver: "codex", config: { binaryPath: "my-codex" } } },
          }),
        );
        const server = yield* startTestServer({ config });
        const { connection } = yield* connectSignedIn(server);

        const state = yield* awaitConnectionState(
          connection,
          (state) => state.config !== undefined,
        );

        assert.deepStrictEqual(state.config?.settings, {
          providerInstances: { codex: { driver: "codex", config: { binaryPath: "my-codex" } } },
          defaultRuntimeMode: "full-access",
        });
      }).pipe(Effect.scoped),
    );
  });
});

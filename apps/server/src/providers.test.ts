import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {
  type ConnectionState,
  type LocalConnection,
  makeLocalConnection,
} from "@playstead/client-runtime/connection";
import { DEFAULT_TEXT_GENERATION_MODEL_SELECTION } from "@playstead/contracts/settings";
import { writeFakeCodex } from "@playstead/provider-testing/fakeProviders";
import { makeTempDirectoryScoped } from "@playstead/shared/tempDirectory";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import { startTestServer, type TestServer } from "./testUtils/testServer.ts";

/**
 * Provider status, refresh and **Binary path** over the RPC contract, as the
 * Settings page uses them, with a fake Codex on disk.
 */

const isWindows = process.platform === "win32";

const awaitConnectionState = (
  connection: LocalConnection,
  matches: (state: ConnectionState) => boolean,
) => connection.changes.pipe(Stream.filter(matches), Stream.runHead, Effect.map(Option.getOrThrow));

/** Signs in with the pairing link the server logs and connects with the cookie. */
const connectSignedIn = (server: TestServer) =>
  Effect.gen(function* () {
    const logged = yield* Queue.take(server.logs).pipe(
      Effect.repeat({ until: (message) => message.includes("/pair#token=") }),
    );
    const token = new URLSearchParams(new URL(/https?:\/\/\S+/.exec(logged)![0]).hash.slice(1)).get(
      "token",
    )!;
    const client = yield* HttpClient.HttpClient;
    const signIn = yield* client.execute(
      HttpClientRequest.post(`${server.baseUrl}/api/auth/browser-session`).pipe(
        HttpClientRequest.bodyJsonUnsafe({ credential: token }),
      ),
    );
    const cookie = signIn.headers["set-cookie"]!.split(";")[0]!;
    const connection = yield* makeLocalConnection({
      httpBaseUrl: server.baseUrl,
      credential: { _tag: "BrowserCookie" },
      socketHeaders: { cookie },
    });
    yield* awaitConnectionState(connection, (state) => state.phase === "connected");
    return connection;
  });

describe("provider RPC methods", () => {
  it.layer(
    Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, NodeSocket.layerWebSocketConstructor),
    { excludeTestServices: true },
  )((it) => {
    it.effect("reports both providers, refreshes them and saves Codex's Binary path", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const emptyBin = yield* makeTempDirectoryScoped("playstead-bin-");
        const ownBin = yield* makeTempDirectoryScoped("playstead-own-");
        const ownCodex = yield* writeFakeCodex({ directory: ownBin, version: "0.160.0" });
        const server = yield* startTestServer({
          providerEnvironment: {
            PATH: [emptyBin, path.dirname(process.execPath)].join(isWindows ? ";" : ":"),
            ...(isWindows
              ? { PATHEXT: ".COM;.EXE;.BAT;.CMD", SystemRoot: process.env.SystemRoot }
              : {}),
          },
        });
        const connection = yield* connectSignedIn(server);

        const refreshed = yield* connection.request((client) =>
          client["server.refreshProviders"]({}),
        );
        assert.deepStrictEqual(
          refreshed.providers.map(({ instanceId, installed }) => ({ instanceId, installed })),
          [
            { instanceId: "codex", installed: false },
            { instanceId: "claudeAgent", installed: false },
          ],
        );

        const settings = yield* connection.request((client) =>
          client["server.updateSettings"]({
            patch: {},
            providerInstanceMutation: {
              operation: "upsert",
              instanceId: "codex",
              instance: { driver: "codex", config: { binaryPath: `  ${ownCodex}  ` } },
            },
          }),
        );
        assert.deepStrictEqual(settings, {
          providerInstances: { codex: { driver: "codex", config: { binaryPath: ownCodex } } },
          textGenerationModelSelection: DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
          defaultRuntimeMode: "full-access",
          sidebarAutoSettleAfterDays: 3,
        });

        const updated = yield* awaitConnectionState(
          connection,
          (state) =>
            state.config?.providers.find((provider) => provider.instanceId === "codex")?.version ===
            "0.160.0",
        );
        assert.deepStrictEqual(updated.config?.settings, settings);
        const saved = yield* Effect.flatMap(FileSystem.FileSystem, (fs) =>
          fs.readFileString(server.config.settingsPath),
        );
        assert.deepStrictEqual(JSON.parse(saved), settings);
      }).pipe(Effect.scoped),
    );

    it.effect("rejects a Binary path aimed at another driver's instance", () =>
      Effect.gen(function* () {
        const server = yield* startTestServer();
        const connection = yield* connectSignedIn(server);

        const result = yield* connection
          .request((client) =>
            client["server.updateSettings"]({
              patch: {},
              providerInstanceMutation: {
                operation: "upsert",
                instanceId: "codex",
                instance: { driver: "claudeAgent", config: { binaryPath: "claude" } },
              },
            }),
          )
          .pipe(Effect.flip);

        assert.strictEqual(result._tag, "ServerSettingsError");
      }).pipe(Effect.scoped),
    );
  });
});

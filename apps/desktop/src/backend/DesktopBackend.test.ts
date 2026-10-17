// @effect-diagnostics nodeBuiltinImport:off -- The test stops the server the way a crash would.
import * as NodeProcess from "node:process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import { makeTempDirectoryScoped } from "@playstead/shared/tempDirectory";

import { awaitBackendReady, makeDesktopBackend } from "./DesktopBackend.ts";
import { exchangeBootstrapToken } from "./DesktopLocalEnvironmentAuth.ts";
import { findAvailablePort } from "./ports.ts";

/** The server's source, which Node runs as it is, as `dev:server` does. */
const serverEntry = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.join(import.meta.dirname, "..", "..", "..", "server", "src", "bin.ts");
});

const startBackend = Effect.gen(function* () {
  const home = yield* makeTempDirectoryScoped("playstead-desktop-home-");
  const port = yield* findAvailablePort(24773);
  const backend = yield* makeDesktopBackend({
    executablePath: process.execPath,
    entryPath: yield* serverEntry,
    baseEnv: process.env,
    bootstrap: {
      port,
      playsteadHome: home,
      desktopBootstrapToken: "desktop-bootstrap-secret",
    },
    output: "ignore",
  });
  return { backend, home, port };
});

describe("desktop backend", () => {
  it.layer(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer), {
    excludeTestServices: true,
  })((it) => {
    it.effect(
      "starts the server with its settings on a private descriptor and is ready once the descriptor answers",
      () =>
        Effect.gen(function* () {
          const { backend, home, port } = yield* startBackend;
          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;

          const ready = yield* awaitBackendReady(backend);
          assert.strictEqual(ready.httpBaseUrl, `http://127.0.0.1:${port}`);
          assert.isTrue(
            yield* fs.exists(path.join(home, "userdata", "state.sqlite")),
            "the server keeps its state in the home it was given",
          );

          const bearer = yield* exchangeBootstrapToken({
            httpBaseUrl: ready.httpBaseUrl,
            bootstrapToken: "desktop-bootstrap-secret",
          });
          const client = yield* HttpClient.HttpClient;
          const ticket = yield* client.execute(
            HttpClientRequest.post(`${ready.httpBaseUrl}/api/auth/websocket-ticket`).pipe(
              HttpClientRequest.bearerToken(bearer),
            ),
          );
          assert.strictEqual(ticket.status, 200, "the bearer token signs the window in");
        }).pipe(Effect.scoped),
    );

    it.effect("starts the server again when it exits", () =>
      Effect.gen(function* () {
        const { backend } = yield* startBackend;
        const first = yield* awaitBackendReady(backend);

        NodeProcess.kill(first.pid);
        const second = yield* awaitBackendReady(backend, (state) => state.pid !== first.pid);

        assert.strictEqual(second.httpBaseUrl, first.httpBaseUrl);
        const client = yield* HttpClient.HttpClient;
        const descriptor = yield* client.get(
          `${second.httpBaseUrl}/.well-known/playstead/environment`,
        );
        assert.strictEqual(descriptor.status, 200);
      }).pipe(Effect.scoped),
    );
  });
});

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {
  type ConnectionState,
  type LocalConnection,
  type LocalConnectionTarget,
  makeLocalConnection,
} from "@playstead/client-runtime/connection";
import { fetchSessionState, signInWithPairingToken } from "@playstead/client-runtime/auth";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";

import { startTestServer, type TestServer } from "./testUtils/testServer.ts";

const DESCRIPTOR_PATH = "/.well-known/playstead/environment";

const awaitLog = (logs: Queue.Dequeue<string>, matches: (message: string) => boolean) =>
  Queue.take(logs).pipe(Effect.repeat({ until: matches }));

const awaitConnectionState = (
  connection: LocalConnection,
  matches: (state: ConnectionState) => boolean,
) => connection.changes.pipe(Stream.filter(matches), Stream.runHead, Effect.map(Option.getOrThrow));

const connect = (target: LocalConnectionTarget) => makeLocalConnection(target);

/** The pairing link the server logs, as the person would copy it from the terminal. */
const awaitPairingToken = (server: TestServer) =>
  Effect.gen(function* () {
    const logged = yield* Queue.take(server.logs).pipe(
      Effect.repeat({ until: (message) => message.includes("/pair#token=") }),
    );
    const link = new URL(/https?:\/\/\S+/.exec(logged)![0]);
    return new URLSearchParams(link.hash.slice(1)).get("token")!;
  });

const postJson = (url: string, body: unknown) =>
  HttpClient.HttpClient.pipe(
    Effect.flatMap((client) =>
      client.execute(HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe(body))),
    ),
  );

describe("server", () => {
  // Real sockets and a real clock: the WebSocket client reports a refused
  // upgrade through timers the test clock would hold back. No test sleeps.
  it.layer(
    Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, NodeSocket.layerWebSocketConstructor),
    { excludeTestServices: true },
  )((it) => {
    it.effect("answers the environment descriptor only after startup completes", () =>
      Effect.gen(function* () {
        const releaseStartup = yield* Deferred.make<void>();
        const server = yield* startTestServer({ beforeReady: Deferred.await(releaseStartup) });
        const client = yield* HttpClient.HttpClient;

        const descriptorRequest = yield* client.get(`${server.baseUrl}${DESCRIPTOR_PATH}`).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((response) => response.json),
          Effect.scoped,
          Effect.forkScoped,
        );
        yield* awaitLog(server.logs, (message) =>
          message.startsWith("Holding a request until startup completes"),
        );
        assert.isUndefined(descriptorRequest.pollUnsafe());

        yield* Deferred.succeed(releaseStartup, undefined);
        const descriptor = (yield* Fiber.join(descriptorRequest)) as Record<string, unknown>;

        assert.strictEqual(typeof descriptor.environmentId, "string");
        assert.strictEqual(descriptor.serverVersion, "0.1.0");
      }).pipe(Effect.scoped),
    );

    it.effect("refuses a /ws connection with neither a valid ticket nor a session cookie", () =>
      Effect.gen(function* () {
        const server = yield* startTestServer();
        const client = yield* HttpClient.HttpClient;

        const withoutCredential = yield* client.get(`${server.baseUrl}/ws`);
        assert.strictEqual(withoutCredential.status, 401);
        assert.deepStrictEqual(yield* withoutCredential.json, {
          _tag: "EnvironmentAuthInvalidError",
          code: "auth_invalid",
          reason: "missing_credential",
        });
        const withForgedTicket = yield* client.get(`${server.baseUrl}/ws?wsTicket=forged.ticket`);
        assert.strictEqual(withForgedTicket.status, 401);

        const connection = yield* connect({
          httpBaseUrl: server.baseUrl,
          credential: { _tag: "BrowserCookie" },
        });
        const refused = yield* awaitConnectionState(connection, (state) => state.attempt > 0);
        assert.strictEqual(refused.phase, "reconnecting");
        assert.strictEqual(refused.config, undefined);
      }).pipe(Effect.scoped),
    );

    it.effect("signs a browser in with the pairing link and opens /ws with its cookie", () =>
      Effect.gen(function* () {
        const server = yield* startTestServer();
        const token = yield* awaitPairingToken(server);

        const signIn = yield* postJson(`${server.baseUrl}/api/auth/browser-session`, {
          credential: token,
        });
        assert.strictEqual(signIn.status, 200);
        const cookie = signIn.headers["set-cookie"]?.split(";")[0];
        assert.isDefined(cookie);

        const reused = yield* postJson(`${server.baseUrl}/api/auth/browser-session`, {
          credential: token,
        });
        assert.strictEqual(reused.status, 401, "a pairing link signs in only once");

        const connection = yield* connect({
          httpBaseUrl: server.baseUrl,
          credential: { _tag: "BrowserCookie" },
          socketHeaders: { cookie: cookie! },
        });
        const ready = yield* awaitConnectionState(
          connection,
          (state) => state.phase === "connected" && state.lifecycle?.type === "ready",
        );
        assert.strictEqual(ready.config?.auth.policy, "loopback-browser");
        assert.strictEqual(ready.lifecycle?.payload.environment.serverVersion, "0.1.0");
      }).pipe(Effect.scoped),
    );

    it.effect("tells the interface's session check whether the browser is signed in", () =>
      Effect.gen(function* () {
        const server = yield* startTestServer();
        const token = yield* awaitPairingToken(server);
        const before = yield* fetchSessionState({ httpBaseUrl: server.baseUrl });
        assert.isFalse(before.authenticated);

        const signIn = yield* postJson(`${server.baseUrl}/api/auth/browser-session`, {
          credential: token,
        });
        const cookie = signIn.headers["set-cookie"]!.split(";")[0]!;
        const after = yield* fetchSessionState({
          httpBaseUrl: server.baseUrl,
          headers: { cookie },
        });

        assert.isTrue(after.authenticated);
        assert.strictEqual(after.sessionMethod, "browser-session-cookie");
        assert.isTrue(after.expiresAt !== undefined && DateTime.isDateTime(after.expiresAt));
      }).pipe(Effect.scoped),
    );

    it.effect("tells the interface when a pairing link was already used", () =>
      Effect.gen(function* () {
        const server = yield* startTestServer();
        const token = yield* awaitPairingToken(server);
        const target = { httpBaseUrl: server.baseUrl };

        assert.strictEqual(yield* signInWithPairingToken(target, token), "Paired");
        assert.strictEqual(yield* signInWithPairingToken(target, token), "Rejected");
      }).pipe(Effect.scoped),
    );

    it.effect(
      "exchanges the desktop bootstrap token for a bearer token and opens /ws with a ticket",
      () =>
        Effect.gen(function* () {
          const server = yield* startTestServer({
            desktopBootstrapToken: "desktop-bootstrap-secret",
          });
          const client = yield* HttpClient.HttpClient;

          const exchange = yield* client.execute(
            HttpClientRequest.post(`${server.baseUrl}/oauth/token`).pipe(
              HttpClientRequest.bodyUrlParams({
                grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
                subject_token: "desktop-bootstrap-secret",
                subject_token_type: "urn:playstead:params:oauth:token-type:environment-bootstrap",
                requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
              }),
            ),
          );
          assert.strictEqual(exchange.status, 200);
          const { access_token } = (yield* exchange.json) as { access_token: string };

          const connection = yield* connect({
            httpBaseUrl: server.baseUrl,
            credential: { _tag: "Bearer", token: Effect.succeed(access_token) },
          });
          const connected = yield* awaitConnectionState(
            connection,
            (state) => state.phase === "connected",
          );
          assert.strictEqual(connected.config?.environment.serverVersion, "0.1.0");
        }).pipe(Effect.scoped),
    );

    it.effect("lets the desktop window's page ask for a WebSocket ticket across origins", () =>
      Effect.gen(function* () {
        const server = yield* startTestServer();
        const client = yield* HttpClient.HttpClient;
        const preflight = (origin: string) =>
          client.execute(
            HttpClientRequest.make("OPTIONS")(`${server.baseUrl}/api/auth/websocket-ticket`).pipe(
              HttpClientRequest.setHeaders({
                origin,
                "access-control-request-method": "POST",
                "access-control-request-headers": "authorization,traceparent,b3",
              }),
            ),
          );

        const fromWindow = yield* preflight("playstead-dev://app");
        assert.strictEqual(
          fromWindow.headers["access-control-allow-origin"],
          "playstead-dev://app",
        );
        // The client's HTTP requests carry tracing headers.
        assert.includeMembers(
          fromWindow.headers["access-control-allow-headers"]?.split(",") ?? [],
          ["authorization", "traceparent", "b3"],
        );
        const fromElsewhere = yield* preflight("http://localhost:9999");
        assert.isUndefined(fromElsewhere.headers["access-control-allow-origin"]);
      }).pipe(Effect.scoped),
    );

    it.effect("keeps its state in the Playstead home, starting at its own first migration", () =>
      Effect.gen(function* () {
        const server = yield* startTestServer({ devUrl: new URL("http://localhost:5999/") });
        assert.isTrue(server.config.dbPath.startsWith(server.config.baseDir));
        assert.isTrue(server.config.stateDir.endsWith("dev"));

        const migrations = yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            readonly migration_id: number;
            readonly name: string;
          }>`SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`;
        }).pipe(
          Effect.provide(SqliteClient.layer({ filename: server.config.dbPath, readonly: true })),
        );
        assert.deepStrictEqual(
          migrations.map((row) => ({ ...row })),
          [
            { migration_id: 1, name: "Initial" },
            { migration_id: 2, name: "Projects" },
            { migration_id: 3, name: "Orchestration" },
            { migration_id: 4, name: "RuntimeRequests" },
            { migration_id: 5, name: "ProjectDeletion" },
          ],
        );
      }).pipe(Effect.scoped),
    );
  });
});

import { AuthWebSocketTicketResult, WEBSOCKET_TICKET_QUERY_PARAM } from "@playstead/contracts/auth";
import type { OrchestrationV2ShellSnapshot } from "@playstead/contracts/orchestrationV2";
import type {
  ServerConfig,
  ServerConfigStreamEvent,
  ServerLifecycleStreamEvent,
} from "@playstead/contracts/server";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type * as Socket from "effect/socket/Socket";

import { applyShellStreamItem } from "../state/shell.ts";
import {
  ConnectionTransientError,
  connectRpcSession,
  type RpcSession,
  type WsRpcClient,
} from "../rpc/session.ts";

/**
 * How the client proves who it is. A browser's session cookie goes with the
 * upgrade by itself. A bearer client, the desktop window, first trades its
 * token for a short-lived WebSocket ticket.
 */
export type LocalCredential =
  | { readonly _tag: "BrowserCookie" }
  | { readonly _tag: "Bearer"; readonly token: Effect.Effect<string, ConnectionTransientError> };

export interface LocalConnectionTarget {
  /** The server's origin, such as the page's own origin in development. */
  readonly httpBaseUrl: string;
  readonly credential: LocalCredential;
  /** Handshake headers, which only a Node WebSocket can send. */
  readonly socketHeaders?: Readonly<Record<string, string>>;
}

export type ConnectionPhase = "connecting" | "connected" | "reconnecting";

export interface ConnectionState {
  readonly phase: ConnectionPhase;
  /** Failed attempts since the last connection. */
  readonly attempt: number;
  readonly lastError: string | undefined;
  readonly config: ServerConfig | undefined;
  /** The environment's latest lifecycle event. */
  readonly lifecycle: ServerLifecycleStreamEvent | undefined;
  /** The sidebar's shell: the environment's projects, current while connected. */
  readonly shell: OrchestrationV2ShellSnapshot | undefined;
}

export interface LocalConnection {
  readonly state: SubscriptionRef.SubscriptionRef<ConnectionState>;
  readonly changes: Stream.Stream<ConnectionState>;
  /** Calls the server over the open session; fails while there is none. */
  readonly request: <A, E>(
    call: (client: WsRpcClient) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ConnectionTransientError>;
}

/** The config stream keeps the server's status, provider statuses and settings current. */
const applyConfigEvent = (
  config: ServerConfig | undefined,
  event: ServerConfigStreamEvent,
): ServerConfig | undefined => {
  switch (event.type) {
    case "snapshot":
      return event.config;
    case "providerStatuses":
      return config && { ...config, providers: event.payload.providers };
    case "settingsUpdated":
      return config && { ...config, settings: event.payload.settings };
  }
};

const initialState: ConnectionState = {
  phase: "connecting",
  attempt: 0,
  lastError: undefined,
  config: undefined,
  lifecycle: undefined,
  shell: undefined,
};

/** Jittered within [cap/2, cap], where cap doubles from 2 s up to 5 minutes. */
const retryDelay = (attempt: number) =>
  Effect.gen(function* () {
    const cap = Math.min(300_000, 1000 * 2 ** (attempt + 1));
    return Duration.millis(yield* Random.nextIntBetween(Math.floor(cap / 2), cap));
  });

const toSocketBaseUrl = (httpBaseUrl: string) => {
  const url = new URL("/ws", httpBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
};

const fetchWebSocketTicket = (httpBaseUrl: string, token: string) =>
  HttpClient.HttpClient.pipe(
    Effect.flatMap((client) =>
      client.execute(
        HttpClientRequest.post(new URL("/api/auth/websocket-ticket", httpBaseUrl).toString()).pipe(
          HttpClientRequest.bearerToken(token),
        ),
      ),
    ),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(AuthWebSocketTicketResult)),
    Effect.map((result) => result.ticket),
    Effect.mapError(
      (cause) =>
        new ConnectionTransientError({
          detail: `Could not get a WebSocket ticket: ${cause.message}`,
        }),
    ),
    Effect.scoped,
  );

const resolveSocketUrl = (target: LocalConnectionTarget) =>
  Effect.gen(function* () {
    const url = toSocketBaseUrl(target.httpBaseUrl);
    if (target.credential._tag === "Bearer") {
      const token = yield* target.credential.token;
      url.searchParams.set(
        WEBSOCKET_TICKET_QUERY_PARAM,
        yield* fetchWebSocketTicket(target.httpBaseUrl, token),
      );
    }
    return url.toString();
  });

/**
 * The client's one owner of its connection to the local server. It opens a
 * session, keeps the server's status and lifecycle current, and reconnects
 * with backoff when the socket closes, for as long as its scope lives.
 */
export const makeLocalConnection = Effect.fn("makeLocalConnection")(function* (
  target: LocalConnectionTarget,
): Effect.fn.Return<
  LocalConnection,
  never,
  Scope.Scope | Socket.WebSocketConstructor | HttpClient.HttpClient
> {
  const state = yield* SubscriptionRef.make(initialState);
  const currentClient = yield* Ref.make<WsRpcClient | undefined>(undefined);

  const runSession = (session: RpcSession) =>
    Effect.gen(function* () {
      // Before the state says connected, so a request made on that news goes through.
      yield* Ref.set(currentClient, session.client);
      yield* SubscriptionRef.update(state, (current): ConnectionState => ({
        ...current,
        phase: "connected",
        attempt: 0,
        lastError: undefined,
        config: session.initialConfig,
      }));
      const lifecycle = session.client.subscribeServerLifecycle({}).pipe(
        Stream.runForEach((event) =>
          SubscriptionRef.update(state, (current) => ({ ...current, lifecycle: event })),
        ),
        Effect.mapError(
          (error) =>
            new ConnectionTransientError({ detail: `Lifecycle stream failed: ${error.message}` }),
        ),
      );
      const config = session.client.subscribeServerConfig({}).pipe(
        Stream.runForEach((event) =>
          SubscriptionRef.update(state, (current) => ({
            ...current,
            config: applyConfigEvent(current.config, event),
          })),
        ),
        Effect.mapError(
          (error) =>
            new ConnectionTransientError({ detail: `Config stream failed: ${error.message}` }),
        ),
      );
      const shell = session.client["orchestration.subscribeShell"]({}).pipe(
        Stream.runForEach((item) =>
          SubscriptionRef.update(state, (current) => ({
            ...current,
            shell: applyShellStreamItem(current.shell, item),
          })),
        ),
        Effect.mapError(
          (error) =>
            new ConnectionTransientError({ detail: `Shell stream failed: ${error.message}` }),
        ),
      );
      const streams = Effect.all([lifecycle, config, shell], { concurrency: "unbounded" });
      return yield* Effect.raceFirst(session.closed, Effect.andThen(streams, session.closed)).pipe(
        Effect.ensuring(Ref.set(currentClient, undefined)),
      );
    });

  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const socketUrl = yield* resolveSocketUrl(target);
      const session = yield* connectRpcSession(
        socketUrl,
        target.socketHeaders ? { headers: target.socketHeaders } : undefined,
      );
      return yield* runSession(session);
    }),
  );

  const supervise = Effect.forever(
    attempt.pipe(
      Effect.catch((error: ConnectionTransientError) =>
        Effect.gen(function* () {
          const next = yield* SubscriptionRef.updateAndGet(state, (current): ConnectionState => ({
            ...current,
            phase: "reconnecting",
            attempt: current.attempt + 1,
            lastError: error.message,
          }));
          yield* Effect.sleep(yield* retryDelay(next.attempt - 1));
        }),
      ),
    ),
  );

  yield* Effect.forkScoped(supervise);

  const request = <A, E>(call: (client: WsRpcClient) => Effect.Effect<A, E>) =>
    Effect.flatMap(
      Ref.get(currentClient),
      (client): Effect.Effect<A, E | ConnectionTransientError> =>
        client === undefined
          ? Effect.fail(new ConnectionTransientError({ detail: "Not connected to the server." }))
          : call(client),
    );

  return { state, changes: SubscriptionRef.changes(state), request };
});

import { AuthWebSocketTicketResult, WEBSOCKET_TICKET_QUERY_PARAM } from "@playstead/contracts/auth";
import type { ServerConfig, ServerLifecycleStreamEvent } from "@playstead/contracts/server";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type * as Socket from "effect/socket/Socket";

import { ConnectionTransientError, connectRpcSession, type RpcSession } from "../rpc/session.ts";

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
}

export interface LocalConnection {
  readonly state: SubscriptionRef.SubscriptionRef<ConnectionState>;
  readonly changes: Stream.Stream<ConnectionState>;
}

const initialState: ConnectionState = {
  phase: "connecting",
  attempt: 0,
  lastError: undefined,
  config: undefined,
  lifecycle: undefined,
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

  const runSession = (session: RpcSession) =>
    Effect.gen(function* () {
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
      return yield* Effect.raceFirst(session.closed, Effect.andThen(lifecycle, session.closed));
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

  return { state, changes: SubscriptionRef.changes(state) };
});

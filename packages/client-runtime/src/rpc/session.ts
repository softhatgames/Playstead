import { WsRpcGroup } from "@playstead/contracts/rpc";
import type { ServerConfig } from "@playstead/contracts/server";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";

const SOCKET_OPEN_TIMEOUT = "15 seconds";
// Pings go out every 5 seconds, and a server busy for a few seconds stops
// answering them. Allow 15 seconds without any frame before dropping the socket.
const PING_TIMEOUT = "15 seconds";

const makeWsRpcClient = RpcClient.make(WsRpcGroup);
export type WsRpcClient = Effect.Success<typeof makeWsRpcClient>;

/** The socket closed or never opened. The connection owner retries. */
export class ConnectionTransientError extends Schema.TaggedError<ConnectionTransientError>()(
  "ConnectionTransientError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface RpcSession {
  readonly client: WsRpcClient;
  /** The server's status, read when the socket opened. */
  readonly initialConfig: ServerConfig;
  /** Fails when the socket closes. */
  readonly closed: Effect.Effect<never, ConnectionTransientError>;
}

/**
 * One RPC session over one WebSocket. It does not reconnect: the connection
 * owner starts a new session when this one closes.
 */
export const connectRpcSession = Effect.fn("connectRpcSession")(function* (
  socketUrl: string,
  options?: { readonly headers?: Readonly<Record<string, string>> },
): Effect.fn.Return<
  RpcSession,
  ConnectionTransientError,
  Scope.Scope | Socket.WebSocketConstructor
> {
  const connected = yield* Deferred.make<void>();
  const disconnected = yield* Deferred.make<never, ConnectionTransientError>();
  const hooks = RpcClient.ConnectionHooks.of({
    onConnect: Deferred.succeed(connected, undefined).pipe(Effect.asVoid),
    onDisconnect: Deferred.isDone(connected).pipe(
      Effect.flatMap((wasConnected) =>
        Deferred.fail(
          disconnected,
          new ConnectionTransientError({
            detail: wasConnected
              ? "The server disconnected."
              : "Could not open a WebSocket to the server.",
          }),
        ),
      ),
      Effect.asVoid,
    ),
  });
  const webSocketConstructor = yield* Socket.WebSocketConstructor;
  const layerProtocol = Layer.effect(
    RpcClient.Protocol,
    RpcClient.makeProtocolSocket({
      pingTimeout: PING_TIMEOUT,
      retryTransientErrors: false,
      // The connection owner reconnects; this socket never retries on its own.
      retryPolicy: Schedule.recurs(0),
    }),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        Socket.layerWebSocket(socketUrl, {
          openTimeout: SOCKET_OPEN_TIMEOUT,
          ...(options?.headers ? { headers: options.headers } : {}),
        }).pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, webSocketConstructor))),
        RpcSerialization.layerJson,
        Layer.succeed(RpcClient.ConnectionHooks, hooks),
      ),
    ),
  );
  const protocol = yield* Layer.build(layerProtocol);
  const client = yield* makeWsRpcClient.pipe(Effect.provideContext(protocol));
  const initialConfig = yield* client["server.getConfig"]({}).pipe(
    Effect.mapError(
      (error) =>
        new ConnectionTransientError({ detail: `Could not reach the server: ${error.message}` }),
    ),
    Effect.raceFirst(Deferred.await(disconnected)),
  );
  return { client, initialConfig, closed: Deferred.await(disconnected) };
});

import {
  type ConnectionState,
  type LocalConnection,
  makeLocalConnection,
  type WsRpcClient,
} from "@playstead/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Socket from "effect/socket/Socket";
import { useSyncExternalStore } from "react";

const runtime = ManagedRuntime.make(
  Layer.mergeAll(FetchHttpClient.layer, Socket.layerWebSocketConstructorGlobal),
);

let current: ConnectionState | undefined;
let connection: LocalConnection | undefined;
const listeners = new Set<() => void>();
let started = false;

/**
 * The page's connection to the server it was loaded from. The browser's
 * session cookie authenticates `/ws`; the client runtime reconnects.
 */
function startPrimaryConnection() {
  if (started) return;
  started = true;
  void runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* makeLocalConnection({
          httpBaseUrl: window.location.origin,
          credential: { _tag: "BrowserCookie" },
        });
        connection = opened;
        yield* Stream.runForEach(opened.changes, (state) =>
          Effect.sync(() => {
            current = state;
            for (const listener of listeners) listener();
          }),
        );
      }),
    ),
  );
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Calls the server over the page's connection. */
export function requestPrimary<A, E>(
  call: (client: WsRpcClient) => Effect.Effect<A, E>,
): Promise<A> {
  if (connection === undefined) return Promise.reject(new Error("Not connected to the server."));
  return runtime.runPromise(connection.request(call));
}

export function usePrimaryConnectionState(): ConnectionState | undefined {
  startPrimaryConnection();
  return useSyncExternalStore(subscribe, () => current);
}

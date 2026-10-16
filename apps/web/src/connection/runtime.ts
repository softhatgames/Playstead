import { type ConnectionState, makeLocalConnection } from "@playstead/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Socket from "effect/socket/Socket";
import { useSyncExternalStore } from "react";

/** The page's Effect runtime: HTTP through fetch, sockets through the browser's WebSocket. */
export const runtime = ManagedRuntime.make(
  Layer.mergeAll(FetchHttpClient.layer, Socket.layerWebSocketConstructorGlobal),
);

let current: ConnectionState | undefined;
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
        const connection = yield* makeLocalConnection({
          httpBaseUrl: window.location.origin,
          credential: { _tag: "BrowserCookie" },
        });
        yield* Stream.runForEach(connection.changes, (state) =>
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

export function usePrimaryConnectionState(): ConnectionState | undefined {
  startPrimaryConnection();
  return useSyncExternalStore(subscribe, () => current);
}

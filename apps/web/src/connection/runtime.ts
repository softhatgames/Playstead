import {
  ConnectionTransientError,
  type ConnectionState,
  type LocalConnectionTarget,
  makeLocalConnection,
} from "@playstead/client-runtime/connection";
import { PRIMARY_LOCAL_ENVIRONMENT_ID } from "@playstead/contracts/ipc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Socket from "effect/socket/Socket";
import { useSyncExternalStore } from "react";

import { desktopBridge } from "../env.ts";

/** The page's Effect runtime: HTTP through fetch, sockets through the browser's WebSocket. */
export const runtime = ManagedRuntime.make(
  Layer.mergeAll(FetchHttpClient.layer, Socket.layerWebSocketConstructorGlobal),
);

let current: ConnectionState | undefined;
const listeners = new Set<() => void>();
let started = false;

/**
 * In the desktop window, the desktop app's own server with the bearer token
 * the app hands over (T3 Code's `resolveDesktopPrimaryTarget`,
 * `apps/web/src/environments/primary/target.ts`). In a browser, the server the
 * page was loaded from, signed in by its session cookie.
 */
const resolvePrimaryTarget = (): LocalConnectionTarget => {
  const bridge = desktopBridge;
  const primary = bridge
    ?.getLocalEnvironmentBootstraps()
    .find((bootstrap) => bootstrap.id === PRIMARY_LOCAL_ENVIRONMENT_ID);
  if (bridge === undefined || primary === undefined) {
    return { httpBaseUrl: window.location.origin, credential: { _tag: "BrowserCookie" } };
  }
  return {
    httpBaseUrl: primary.httpBaseUrl,
    credential: {
      _tag: "Bearer",
      token: Effect.tryPromise({
        try: () => bridge.getLocalEnvironmentBearerToken(),
        catch: (cause) =>
          new ConnectionTransientError({
            detail: `No bearer token from the desktop app: ${String(cause)}`,
          }),
      }),
    },
  };
};

/** The page's one connection to its server; the client runtime reconnects. */
function startPrimaryConnection() {
  if (started) return;
  started = true;
  void runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* makeLocalConnection(resolvePrimaryTarget());
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

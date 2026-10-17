import {
  ConnectionTransientError,
  type ConnectionState,
  type ConnectionWakeup,
  type LocalConnection,
  type LocalConnectionTarget,
  makeLocalConnection,
  type WsRpcClient,
} from "@playstead/client-runtime/connection";
import { followThread, type ThreadState } from "@playstead/client-runtime/state/thread";
import type { ThreadId } from "@playstead/contracts/baseSchemas";
import { PRIMARY_LOCAL_ENVIRONMENT_ID } from "@playstead/contracts/ipc";
import type { OrchestrationThreadNotFoundError } from "@playstead/contracts/orchestrationV2";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Queue from "effect/Queue";
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
let connection: LocalConnection | undefined;
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

interface NetworkInformationLike extends EventTarget {
  readonly type?: string;
}

/**
 * The page's wakeups, as T3 Code's web platform has them
 * (`apps/web/src/connection/platform.ts` at a9c9c7c): the page becoming
 * visible, and the network's type changing. `change` also fires for new
 * bandwidth estimates on the same network, so only a new type counts.
 */
const pageWakeups = Stream.mergeAll(
  [
    Stream.fromEventListener(document, "visibilitychange").pipe(
      Stream.filter(() => document.visibilityState === "visible"),
      Stream.map((): ConnectionWakeup => "application-active"),
    ),
    Stream.callback<ConnectionWakeup>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const network = (
            navigator as Navigator & { readonly connection?: NetworkInformationLike }
          ).connection;
          if (network?.type === undefined) return undefined;
          let previous = network.type;
          const listener = () => {
            if (network.type === undefined || network.type === previous) return;
            previous = network.type;
            Queue.offerUnsafe(queue, "network-changed");
          };
          network.addEventListener("change", listener);
          return { network, listener };
        }),
        (subscription) =>
          Effect.sync(() =>
            subscription?.network.removeEventListener("change", subscription.listener),
          ),
      ).pipe(Effect.asVoid),
    ),
  ],
  { concurrency: "unbounded" },
);

/** The page's one connection to its server; the client runtime reconnects. */
function startPrimaryConnection() {
  if (started) return;
  started = true;
  void runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* makeLocalConnection(resolvePrimaryTarget(), {
          wakeups: pageWakeups,
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

/** Runs a subscription on the current connection; its owner restarts it on reconnect. */
export function runPrimaryStream<A, E>(
  call: (client: WsRpcClient) => Stream.Stream<A, E>,
  onItem: (item: A) => void,
  onError: (error: E | ConnectionTransientError) => void,
): () => void {
  if (connection === undefined) return () => {};
  const fiber = runtime.runFork(
    connection.stream(call).pipe(
      Stream.runForEach((item) => Effect.sync(() => onItem(item))),
      Effect.catch((error) => Effect.sync(() => onError(error))),
    ),
  );
  return () => fiber.interruptUnsafe();
}

/**
 * Follows one thread over the page's connection until the returned function
 * stops it: the state stays while the server is away, and is replaced once
 * it is back (`followThread`). It ends only when the server has no such thread.
 */
export function followPrimaryThread(
  threadId: ThreadId,
  onState: (state: ThreadState) => void,
  onNotFound: (error: OrchestrationThreadNotFoundError) => void,
): () => void {
  if (connection === undefined) return () => {};
  const fiber = runtime.runFork(
    followThread(connection, threadId).pipe(
      Stream.runForEach((state) => Effect.sync(() => onState(state))),
      Effect.catch((error) => Effect.sync(() => onNotFound(error))),
    ),
  );
  return () => {
    fiber.interruptUnsafe();
  };
}

export function usePrimaryConnectionState(): ConnectionState | undefined {
  startPrimaryConnection();
  return useSyncExternalStore(subscribe, () => current);
}

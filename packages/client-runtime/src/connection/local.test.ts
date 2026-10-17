import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as Socket from "effect/socket/Socket";

import { type ConnectionWakeup, type LocalConnection, makeLocalConnection } from "./local.ts";

/** A server that is down: every socket is closed before it opens. */
const serverDown = Layer.mergeAll(
  Layer.succeed(Socket.WebSocketConstructor, (): Socket.WebSocketLike => ({
    readyState: 3,
    addEventListener: () => {},
    removeEventListener: () => {},
    close: () => {},
    send: () => {},
  })),
  // A browser's cookie goes with the upgrade, so nothing is fetched first.
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() => Effect.die("No HTTP request was expected.")),
  ),
);

const awaitFailures = (connection: LocalConnection, failures: number) =>
  connection.changes.pipe(
    Stream.filter((state) => state.attempt >= failures),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

describe("The connection's retries", () => {
  // Real time: each refused try takes about a second to fail, as the RPC
  // client waits that long for the closed socket to take its interrupt.
  it.live(
    "a wakeup tries again at once, and the waits start short again",
    () =>
      Effect.gen(function* () {
        const wakeups = yield* Queue.unbounded<ConnectionWakeup>();
        const connection = yield* makeLocalConnection(
          { httpBaseUrl: "http://127.0.0.1:3773", credential: { _tag: "BrowserCookie" } },
          { wakeups: Stream.fromQueue(wakeups) },
        ).pipe(Effect.provide(serverDown));

        // After three failures the next wait is 4 to 8 s.
        yield* awaitFailures(connection, 3).pipe(Effect.timeout("20 seconds"));
        yield* Queue.offer(wakeups, "application-active");
        yield* awaitFailures(connection, 4).pipe(Effect.timeout("3 seconds"));
        // Then 1 to 2 s, not the 8 to 16 s a fifth failure would have waited.
        yield* awaitFailures(connection, 5).pipe(Effect.timeout("4 seconds"));
      }).pipe(Effect.scoped),
    40_000,
  );
});

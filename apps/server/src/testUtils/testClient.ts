import {
  type ConnectionState,
  type LocalConnection,
  makeLocalConnection,
} from "@playstead/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import type { TestServer } from "./testServer.ts";

export const awaitConnectionState = (
  connection: LocalConnection,
  matches: (state: ConnectionState) => boolean,
) => connection.changes.pipe(Stream.filter(matches), Stream.runHead, Effect.map(Option.getOrThrow));

/**
 * A browser's connection: it signs in with the pairing link the server logs,
 * as the person would, and connects with the session cookie.
 */
export const connectSignedIn = (server: TestServer) =>
  Effect.gen(function* () {
    const logged = yield* Queue.take(server.logs).pipe(
      Effect.repeat({ until: (message) => message.includes("/pair#token=") }),
    );
    const link = new URL(/https?:\/\/\S+/.exec(logged)![0]);
    const token = new URLSearchParams(link.hash.slice(1)).get("token")!;
    const client = yield* HttpClient.HttpClient;
    const signIn = yield* client.execute(
      HttpClientRequest.post(`${server.baseUrl}/api/auth/browser-session`).pipe(
        HttpClientRequest.bodyJsonUnsafe({ credential: token }),
      ),
    );
    const cookie = signIn.headers["set-cookie"]!.split(";")[0]!;
    const connection = yield* makeLocalConnection({
      httpBaseUrl: server.baseUrl,
      credential: { _tag: "BrowserCookie" },
      socketHeaders: { cookie },
    });
    yield* awaitConnectionState(connection, (state) => state.phase === "connected");
    return { connection, cookie };
  });

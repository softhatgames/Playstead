import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as TestClock from "effect/testing/TestClock";

import { fetchSessionState } from "./browserSession.ts";

const signedIn = {
  authenticated: true,
  auth: {
    policy: "loopback-browser",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["browser-session-cookie"],
    sessionCookieName: "playstead_session",
  },
  sessionMethod: "browser-session-cookie",
};

type Answer = "unreachable" | number;

/**
 * A server that gives each session check the next answer: unreachable (as
 * fetch fails while nothing listens), a status alone (as the development
 * proxy answers 502 while the server is down) or 200 with the session.
 */
const serverAnswering = (answers: ReadonlyArray<Answer>) => {
  const remaining = [...answers];
  let asked = 0;
  const client = HttpClient.make((request) => {
    asked += 1;
    const answer = remaining.shift() ?? 200;
    if (answer === "unreachable") {
      return Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request, description: "Failed to fetch" }),
        }),
      );
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(answer === 200 ? JSON.stringify(signedIn) : "Bad Gateway", {
          status: answer,
          headers: { "content-type": answer === 200 ? "application/json" : "text/plain" },
        }),
      ),
    );
  });
  return { layer: Layer.succeed(HttpClient.HttpClient, client), asked: () => asked };
};

/** Lets time pass, as it would while the server is down, until the check settles. */
const settle = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.gen(function* () {
    for (let minute = 0; minute < 60 && fiber.pollUnsafe() === undefined; minute++) {
      yield* TestClock.adjust("1 minute");
    }
    return yield* Fiber.await(fiber);
  });

describe("The session check", () => {
  it.effect("waits through a server restart and answers once the server is back", () =>
    Effect.gen(function* () {
      const server = serverAnswering(["unreachable", 502, 503, "unreachable", 504, 200]);
      const check = yield* fetchSessionState({ httpBaseUrl: "http://127.0.0.1:3773" }).pipe(
        Effect.provide(server.layer),
        Effect.forkChild,
      );

      const exit = yield* settle(check);

      assert.deepStrictEqual(
        Exit.map(exit, (state) => state.authenticated),
        Exit.succeed(true),
      );
      assert.strictEqual(server.asked(), 6);
    }),
  );

  it.effect("fails at once on an answer a restart does not explain", () =>
    Effect.gen(function* () {
      const server = serverAnswering([404]);
      const check = yield* fetchSessionState({ httpBaseUrl: "http://127.0.0.1:3773" }).pipe(
        Effect.provide(server.layer),
        Effect.forkChild,
      );

      const exit = yield* settle(check);

      assert.isTrue(Exit.isFailure(exit));
      assert.strictEqual(server.asked(), 1);
    }),
  );
});

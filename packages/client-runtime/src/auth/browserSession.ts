import { AuthSessionState } from "@playstead/contracts/auth";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { retryDelay } from "../connection/retryDelay.ts";

/** How a browser reaches the server: its base URL and, outside a page, the cookie to send. */
export interface BrowserSessionTarget {
  readonly httpBaseUrl: string;
  readonly headers?: Record<string, string>;
}

const request = (target: BrowserSessionTarget, req: HttpClientRequest.HttpClientRequest) =>
  HttpClient.HttpClient.pipe(
    Effect.flatMap((client) =>
      client.execute(target.headers ? HttpClientRequest.setHeaders(req, target.headers) : req),
    ),
  );

const urlFor = (target: BrowserSessionTarget, path: string) =>
  new URL(path, target.httpBaseUrl).toString();

/**
 * Whether the server is down or restarting: nothing answers, or the proxy in
 * front of it (Vite's, in development) says the server is unavailable.
 */
const isServerUnreachable = (error: unknown) =>
  HttpClientError.isHttpClientError(error) &&
  (error.reason._tag === "TransportError" ||
    (error.reason._tag === "StatusCodeError" &&
      [502, 503, 504].includes(error.reason.response.status)));

/** Tries again, with the connection's backoff, for as long as the server cannot be reached. */
const untilServerAnswers = <A, E, R>(effect: Effect.Effect<A, E, R>) => {
  const attempt = (failures: number): Effect.Effect<A, E, R> =>
    effect.pipe(
      Effect.catchIf(isServerUnreachable, () =>
        retryDelay(failures).pipe(
          Effect.flatMap(Effect.sleep),
          Effect.andThen(Effect.suspend(() => attempt(failures + 1))),
        ),
      ),
    );
  return attempt(0);
};

/**
 * Whether this browser already has a session with the server. The body is
 * read through the schema's JSON encoding, where dates are ISO strings.
 *
 * While the server is down or restarting, the check waits for it, as the
 * WebSocket connection does, so a page loaded meanwhile shows once the
 * server is back instead of an error that only a reload clears. T3 Code's
 * `fetchSessionState` (`apps/web/src/environments/primary/auth.ts` at
 * 2577baf) retries the same failures, but every 500 ms and for 15 s only.
 */
export const fetchSessionState = (target: BrowserSessionTarget) =>
  untilServerAnswers(
    request(target, HttpClientRequest.get(urlFor(target, "/api/auth/session"))).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(AuthSessionState)),
      Effect.scoped,
    ),
  );

/** Trades a pairing link's one-time token for a session cookie. */
export const signInWithPairingToken = (target: BrowserSessionTarget, token: string) =>
  request(
    target,
    HttpClientRequest.post(urlFor(target, "/api/auth/browser-session")).pipe(
      HttpClientRequest.bodyJsonUnsafe({ credential: token }),
    ),
  ).pipe(
    Effect.flatMap((response) =>
      response.status === 401
        ? Effect.succeed("Rejected" as const)
        : HttpClientResponse.filterStatusOk(response).pipe(Effect.as("Paired" as const)),
    ),
    Effect.scoped,
  );

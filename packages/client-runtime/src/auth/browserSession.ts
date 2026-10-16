import { AuthSessionState } from "@playstead/contracts/auth";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

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
 * Whether this browser already has a session with the server. The body is
 * read through the schema's JSON encoding, where dates are ISO strings.
 */
export const fetchSessionState = (target: BrowserSessionTarget) =>
  request(target, HttpClientRequest.get(urlFor(target, "/api/auth/session"))).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(AuthSessionState)),
    Effect.scoped,
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

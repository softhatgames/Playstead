import {
  AuthAccessTokenResult,
  AuthAccessTokenType,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
} from "@playstead/contracts/auth";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

/**
 * Trades the desktop app's bootstrap token for the window's bearer token at
 * `/oauth/token`, retrying while the server comes up, as T3 Code's
 * `apps/desktop/src/backend/DesktopLocalEnvironmentAuth.ts` does (500 ms
 * apart, for up to 15 s).
 */
export const exchangeBootstrapToken = Effect.fn("exchangeBootstrapToken")(function* (input: {
  readonly httpBaseUrl: string;
  readonly bootstrapToken: string;
}) {
  const client = yield* HttpClient.HttpClient;
  const result = yield* client
    .execute(
      HttpClientRequest.post(new URL("/oauth/token", input.httpBaseUrl).toString()).pipe(
        HttpClientRequest.bodyUrlParams({
          grant_type: AuthTokenExchangeGrantType,
          subject_token: input.bootstrapToken,
          subject_token_type: AuthEnvironmentBootstrapTokenType,
          requested_token_type: AuthAccessTokenType,
        }),
      ),
    )
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(AuthAccessTokenResult)),
      Effect.scoped,
      Effect.retry({
        schedule: Schedule.spaced("500 millis"),
        times: 30,
      }),
    );
  return result.access_token;
});

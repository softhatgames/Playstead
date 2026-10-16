import {
  EnvironmentAuthInvalidError,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentHttpApi,
  EnvironmentInternalError,
  type EnvironmentInternalErrorReason,
} from "@playstead/contracts/environmentHttp";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Cookies from "effect/http/Cookies";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as EnvironmentAuth from "./EnvironmentAuth.ts";

const appendCredentialResponseHeaders = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(
    HttpServerResponse.setHeaders(response, { "cache-control": "no-store", pragma: "no-cache" }),
  ),
);

export const failEnvironmentAuthInvalid = (error: EnvironmentAuth.ServerAuthCredentialError) =>
  Effect.fail(new EnvironmentAuthInvalidError({ code: "auth_invalid", reason: error.reason }));

export const failEnvironmentInternal = (reason: EnvironmentInternalErrorReason, cause: unknown) =>
  Effect.logError("Environment request failed.", { reason, cause }).pipe(
    Effect.andThen(Effect.fail(new EnvironmentInternalError({ code: "internal_error", reason }))),
  );

export const layerAuthenticatedAuth = Layer.effect(
  EnvironmentAuthenticatedAuth,
  Effect.gen(function* () {
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* auth.authenticateHttpRequest(request).pipe(
          Effect.catchTags({
            ServerAuthCredentialError: failEnvironmentAuthInvalid,
            ServerAuthInternalError: (error) => failEnvironmentInternal("internal_error", error),
          }),
        );
        return yield* Effect.provideService(httpEffect, EnvironmentAuthenticatedPrincipal, session);
      });
  }),
);

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "auth",
  Effect.fnUntraced(function* (handlers) {
    const auth = yield* EnvironmentAuth.EnvironmentAuth;

    return handlers
      .handle("session", () =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return yield* auth.getSessionState(request);
        }).pipe(
          Effect.catchTag("ServerAuthInternalError", (error) =>
            failEnvironmentInternal("internal_error", error),
          ),
        ),
      )
      .handle("browserSession", (args) =>
        Effect.gen(function* () {
          const result = yield* auth.createBrowserSession(args.payload.credential);
          const cookies = yield* Effect.fromResult(
            Cookies.set(Cookies.empty, auth.cookieName, result.sessionToken, {
              expires: DateTime.toDate(result.response.expiresAt),
              httpOnly: true,
              path: "/",
              sameSite: "lax",
            }),
          ).pipe(
            Effect.catch((cause) =>
              failEnvironmentInternal("browser_session_cookie_failed", cause),
            ),
          );
          yield* HttpEffect.appendPreResponseHandler((_request, response) =>
            Effect.succeed(HttpServerResponse.mergeCookies(response, cookies)),
          );
          yield* appendCredentialResponseHeaders;
          return result.response;
        }).pipe(
          Effect.catchTags({
            ServerAuthCredentialError: failEnvironmentAuthInvalid,
            ServerAuthInternalError: (error) =>
              failEnvironmentInternal("browser_session_issuance_failed", error),
          }),
        ),
      )
      .handle("token", (args) =>
        Effect.gen(function* () {
          yield* appendCredentialResponseHeaders;
          return yield* auth.exchangeBootstrapCredentialForAccessToken(args.payload.subject_token);
        }).pipe(
          Effect.catchTags({
            ServerAuthCredentialError: failEnvironmentAuthInvalid,
            ServerAuthInternalError: (error) =>
              failEnvironmentInternal("access_token_issuance_failed", error),
          }),
        ),
      )
      .handle("webSocketTicket", () =>
        Effect.gen(function* () {
          const session = yield* EnvironmentAuthenticatedPrincipal;
          yield* appendCredentialResponseHeaders;
          return yield* auth.issueWebSocketTicket(session);
        }).pipe(
          Effect.catchTag("ServerAuthInternalError", (error) =>
            failEnvironmentInternal("websocket_ticket_issuance_failed", error),
          ),
        ),
      );
  }),
);

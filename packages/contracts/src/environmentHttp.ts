import * as Context from "effect/Context";
import type * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpServerRespondable from "effect/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { identity } from "@playstead/shared/identity";

import {
  AuthAccessTokenResult,
  AuthBrowserSessionRequest,
  AuthBrowserSessionResult,
  AuthSessionState,
  AuthTokenExchangeRequest,
  AuthWebSocketTicketResult,
  type ServerAuthSessionMethod,
} from "./auth.ts";
import type { AuthSessionId } from "./baseSchemas.ts";
import { ExecutionEnvironmentDescriptor } from "./environment.ts";

const EnvironmentAuthInvalidReason = Schema.Literals(["missing_credential", "invalid_credential"]);
export type EnvironmentAuthInvalidReason = typeof EnvironmentAuthInvalidReason.Type;

export const EnvironmentInternalErrorReason = Schema.Literals([
  "browser_session_issuance_failed",
  "browser_session_cookie_failed",
  "access_token_issuance_failed",
  "websocket_ticket_issuance_failed",
  "internal_error",
]);
export type EnvironmentInternalErrorReason = typeof EnvironmentInternalErrorReason.Type;

export class EnvironmentAuthInvalidError extends Schema.TaggedError<EnvironmentAuthInvalidError>()(
  "EnvironmentAuthInvalidError",
  {
    code: Schema.Literal("auth_invalid"),
    reason: EnvironmentAuthInvalidReason,
  },
  { httpApiStatus: 401 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(EnvironmentAuthInvalidError)(this, { status: 401 });
  }

  override get message(): string {
    return `The environment rejected this client's credentials (${this.reason}).`;
  }
}

export class EnvironmentInternalError extends Schema.TaggedError<EnvironmentInternalError>()(
  "EnvironmentInternalError",
  {
    code: Schema.Literal("internal_error"),
    reason: EnvironmentInternalErrorReason,
  },
  { httpApiStatus: 500 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(EnvironmentInternalError)(this, { status: 500 });
  }

  override get message(): string {
    return `The environment failed to answer this request (${this.reason}).`;
  }
}

const EnvironmentAuthenticationErrors = [
  EnvironmentAuthInvalidError,
  EnvironmentInternalError,
] as const;

export interface EnvironmentSessionPrincipalShape {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly method: ServerAuthSessionMethod;
  readonly expiresAt: DateTime.Utc;
}

export class EnvironmentAuthenticatedPrincipal extends Context.Service<
  EnvironmentAuthenticatedPrincipal,
  EnvironmentSessionPrincipalShape
>()("@playstead/contracts/environmentHttp/EnvironmentAuthenticatedPrincipal") {}

export class EnvironmentAuthenticatedAuth extends HttpApiMiddleware.Service<
  EnvironmentAuthenticatedAuth,
  { provides: EnvironmentAuthenticatedPrincipal }
>()("EnvironmentAuthenticatedAuth", {
  error: EnvironmentAuthenticationErrors,
}) {}

const OptionalBearerHeaders = Schema.Struct({
  authorization: Schema.optionalKey(Schema.String),
});

class EnvironmentMetadataHttpApi extends HttpApiGroup.make("metadata").add(
  HttpApiEndpoint.get("descriptor", identity.environmentDescriptorPath, {
    success: ExecutionEnvironmentDescriptor,
  }),
) {}

class EnvironmentAuthHttpApi extends HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.get("session", "/api/auth/session", {
      headers: OptionalBearerHeaders,
      success: AuthSessionState,
      error: [EnvironmentInternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("browserSession", "/api/auth/browser-session", {
      payload: AuthBrowserSessionRequest,
      success: AuthBrowserSessionResult,
      error: EnvironmentAuthenticationErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("token", "/oauth/token", {
      payload: AuthTokenExchangeRequest,
      success: AuthAccessTokenResult,
      error: EnvironmentAuthenticationErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("webSocketTicket", "/api/auth/websocket-ticket", {
      headers: OptionalBearerHeaders,
      success: AuthWebSocketTicketResult,
      error: [EnvironmentInternalError],
    }).middleware(EnvironmentAuthenticatedAuth),
  ) {}

/**
 * Every HTTP route the server has. Everything else goes over the RPC contract
 * on `/ws`; the server's only other paths are `/ws` itself and the interface's
 * files.
 */
export class EnvironmentHttpApi extends HttpApi.make("environment")
  .add(EnvironmentMetadataHttpApi)
  .add(EnvironmentAuthHttpApi) {}

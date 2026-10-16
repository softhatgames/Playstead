import * as Schema from "effect/Schema";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * How the server lets clients in. A browser on the same computer signs in with
 * the pairing link the server prints. The desktop app's policy arrives with the
 * desktop app.
 */
const ServerAuthPolicy = Schema.Literals(["loopback-browser"]);
export type ServerAuthPolicy = typeof ServerAuthPolicy.Type;

export const ServerAuthBootstrapMethod = Schema.Literals(["desktop-bootstrap", "one-time-token"]);
export type ServerAuthBootstrapMethod = typeof ServerAuthBootstrapMethod.Type;

export const ServerAuthSessionMethod = Schema.Literals([
  "browser-session-cookie",
  "bearer-access-token",
]);
export type ServerAuthSessionMethod = typeof ServerAuthSessionMethod.Type;

export const AuthTokenExchangeGrantType =
  "urn:ietf:params:oauth:grant-type:token-exchange" as const;
export const AuthAccessTokenType = "urn:ietf:params:oauth:token-type:access_token" as const;
export const AuthEnvironmentBootstrapTokenType =
  "urn:playstead:params:oauth:token-type:environment-bootstrap" as const;

/** The query parameter that carries a WebSocket ticket on `/ws`. */
export const WEBSOCKET_TICKET_QUERY_PARAM = "wsTicket";

export const ServerAuthDescriptor = Schema.Struct({
  policy: ServerAuthPolicy,
  bootstrapMethods: Schema.Array(ServerAuthBootstrapMethod),
  sessionMethods: Schema.Array(ServerAuthSessionMethod),
  sessionCookieName: TrimmedNonEmptyString,
});
export type ServerAuthDescriptor = typeof ServerAuthDescriptor.Type;

export const AuthBrowserSessionRequest = Schema.Struct({
  credential: TrimmedNonEmptyString,
});
export type AuthBrowserSessionRequest = typeof AuthBrowserSessionRequest.Type;

export const AuthBrowserSessionResult = Schema.Struct({
  authenticated: Schema.Literal(true),
  sessionMethod: ServerAuthSessionMethod,
  expiresAt: Schema.DateTimeUtc,
});
export type AuthBrowserSessionResult = typeof AuthBrowserSessionResult.Type;

export const AuthTokenExchangeRequest = Schema.Struct({
  grant_type: Schema.Literal(AuthTokenExchangeGrantType),
  subject_token: TrimmedNonEmptyString,
  subject_token_type: Schema.Literal(AuthEnvironmentBootstrapTokenType),
  requested_token_type: Schema.Literal(AuthAccessTokenType),
}).pipe(HttpApiSchema.asFormUrlEncoded());
export type AuthTokenExchangeRequest = typeof AuthTokenExchangeRequest.Type;

export const AuthAccessTokenResult = Schema.Struct({
  access_token: TrimmedNonEmptyString,
  issued_token_type: Schema.Literal(AuthAccessTokenType),
  token_type: Schema.Literal("Bearer"),
  expires_in: Schema.Number,
});
export type AuthAccessTokenResult = typeof AuthAccessTokenResult.Type;

export const AuthWebSocketTicketResult = Schema.Struct({
  ticket: TrimmedNonEmptyString,
  expiresAt: Schema.DateTimeUtc,
});
export type AuthWebSocketTicketResult = typeof AuthWebSocketTicketResult.Type;

export const AuthSessionState = Schema.Struct({
  authenticated: Schema.Boolean,
  auth: ServerAuthDescriptor,
  sessionMethod: Schema.optionalKey(ServerAuthSessionMethod),
  expiresAt: Schema.optionalKey(Schema.DateTimeUtc),
});
export type AuthSessionState = typeof AuthSessionState.Type;

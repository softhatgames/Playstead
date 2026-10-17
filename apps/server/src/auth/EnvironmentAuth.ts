import {
  AuthAccessTokenType,
  WEBSOCKET_TICKET_QUERY_PARAM,
  type AuthAccessTokenResult,
  type AuthBrowserSessionResult,
  type AuthSessionState,
  type AuthWebSocketTicketResult,
  type ServerAuthDescriptor,
} from "@playstead/contracts/auth";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import * as ServerConfig from "../config.ts";
import * as PairingGrantStore from "./PairingGrantStore.ts";
import * as SessionStore from "./SessionStore.ts";

export class ServerAuthCredentialError extends Schema.TaggedError<ServerAuthCredentialError>()(
  "ServerAuthCredentialError",
  { reason: Schema.Literals(["missing_credential", "invalid_credential"]) },
) {
  override get message(): string {
    return `Credential refused (${this.reason}).`;
  }
}

export class ServerAuthInternalError extends Schema.TaggedError<ServerAuthInternalError>()(
  "ServerAuthInternalError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Signing in failed inside the server.";
  }
}

const isServerAuthCredentialError = Schema.is(ServerAuthCredentialError);

export type AuthenticatedSession = SessionStore.VerifiedSession;

/**
 * Signing in, as T3 Code does it: the desktop app's bootstrap token becomes a
 * bearer token, a pairing link becomes a browser session cookie, and `/ws`
 * opens with either a short-lived ticket or that cookie.
 */
export class EnvironmentAuth extends Context.Service<
  EnvironmentAuth,
  {
    readonly descriptor: ServerAuthDescriptor;
    readonly cookieName: string;
    readonly getSessionState: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<AuthSessionState, ServerAuthInternalError>;
    readonly createBrowserSession: (
      credential: string,
    ) => Effect.Effect<
      { readonly response: AuthBrowserSessionResult; readonly sessionToken: string },
      ServerAuthCredentialError | ServerAuthInternalError
    >;
    readonly exchangeBootstrapCredentialForAccessToken: (
      credential: string,
    ) => Effect.Effect<AuthAccessTokenResult, ServerAuthCredentialError | ServerAuthInternalError>;
    readonly issueWebSocketTicket: (
      session: AuthenticatedSession,
    ) => Effect.Effect<AuthWebSocketTicketResult, ServerAuthInternalError>;
    readonly authenticateHttpRequest: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<AuthenticatedSession, ServerAuthCredentialError | ServerAuthInternalError>;
    readonly authenticateWebSocketUpgrade: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<AuthenticatedSession, ServerAuthCredentialError | ServerAuthInternalError>;
    /** A one-time link that signs a browser in, with the token in the URL's hash. */
    readonly issueStartupPairingUrl: (
      baseUrl: string,
    ) => Effect.Effect<string, ServerAuthInternalError>;
  }
>()("@playstead/server/auth/EnvironmentAuth") {}

const BEARER_PREFIX = "Bearer ";

const parseBearerToken = (request: HttpServerRequest.HttpServerRequest): string | undefined => {
  const header = request.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) return undefined;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : undefined;
};

const firstHeaderValue = (value: string | undefined): string | undefined => {
  const first = value?.split(",")[0]?.trim().toLowerCase();
  return first && first.length > 0 ? first : undefined;
};

/**
 * Browsers send `Origin` on WebSocket upgrades and on requests that change
 * something, so no header means a same-origin read or a client that is not a
 * browser. Otherwise a cookie counts only from the server's own pages: the
 * browser says same-origin, the origin is the development URL, or it matches
 * the host the request was sent to. Another page on localhost gets the cookie
 * too, and must not be let in with it.
 */
const isBrowserOriginAllowed = (
  request: HttpServerRequest.HttpServerRequest,
  trustedOrigins: ReadonlySet<string>,
): boolean => {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (request.headers["sec-fetch-site"] === "same-origin") return true;
  if (trustedOrigins.has(origin)) return true;
  const originHost = URL.parse(origin)?.host.toLowerCase();
  return (
    originHost !== undefined &&
    originHost !== "" &&
    originHost === firstHeaderValue(request.headers.host)
  );
};

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const grants = yield* PairingGrantStore.PairingGrantStore;
  const sessions = yield* SessionStore.SessionStore;

  const descriptor: ServerAuthDescriptor = {
    policy: "loopback-browser",
    bootstrapMethods: ["one-time-token", "desktop-bootstrap"],
    sessionMethods: ["browser-session-cookie", "bearer-access-token"],
    sessionCookieName: sessions.cookieName,
  };
  const trustedOrigins = new Set<string>(config.devUrl ? [config.devUrl.origin] : []);

  const toInternal = (cause: unknown) => new ServerAuthInternalError({ cause });

  const verifySession = (
    verify: Effect.Effect<
      SessionStore.VerifiedSession,
      SessionStore.SessionCredentialInvalidError | SessionStore.SessionStoreError
    >,
  ) =>
    verify.pipe(
      Effect.catchTags({
        SessionCredentialInvalidError: (error) =>
          Effect.logDebug("Rejected session credential.").pipe(
            Effect.annotateLogs({ reason: error.reason }),
            Effect.andThen(new ServerAuthCredentialError({ reason: "invalid_credential" })),
          ),
        SessionStoreError: (error) => Effect.fail(toInternal(error)),
      }),
    );

  const authenticateRequest = (request: HttpServerRequest.HttpServerRequest) => {
    const cookieToken = request.cookies[sessions.cookieName];
    if (cookieToken !== undefined) {
      if (!isBrowserOriginAllowed(request, trustedOrigins)) {
        return Effect.fail(new ServerAuthCredentialError({ reason: "invalid_credential" }));
      }
      return verifySession(sessions.verify(cookieToken));
    }
    const bearerToken = parseBearerToken(request);
    if (bearerToken !== undefined) return verifySession(sessions.verify(bearerToken));
    return Effect.fail(new ServerAuthCredentialError({ reason: "missing_credential" }));
  };

  const consumeGrant = (credential: string) =>
    grants.consume(credential).pipe(
      Effect.catchTags({
        BootstrapCredentialInvalidError: () =>
          Effect.fail(new ServerAuthCredentialError({ reason: "invalid_credential" })),
        PairingGrantStoreError: (error) => Effect.fail(toInternal(error)),
      }),
    );

  return EnvironmentAuth.of({
    descriptor,
    cookieName: sessions.cookieName,
    getSessionState: (request) =>
      authenticateRequest(request).pipe(
        Effect.map((session): AuthSessionState => ({
          authenticated: true,
          auth: descriptor,
          sessionMethod: session.method,
          expiresAt: session.expiresAt,
        })),
        Effect.catchIf(isServerAuthCredentialError, () =>
          Effect.succeed<AuthSessionState>({ authenticated: false, auth: descriptor }),
        ),
      ),
    createBrowserSession: (credential) =>
      Effect.gen(function* () {
        const grant = yield* consumeGrant(credential);
        const session = yield* sessions
          .issue({ method: "browser-session-cookie", subject: grant.subject })
          .pipe(Effect.mapError(toInternal));
        return {
          response: {
            authenticated: true,
            sessionMethod: session.method,
            expiresAt: session.expiresAt,
          },
          sessionToken: session.token,
        } as const;
      }),
    exchangeBootstrapCredentialForAccessToken: (credential) =>
      Effect.gen(function* () {
        const grant = yield* consumeGrant(credential);
        const session = yield* sessions
          .issue({ method: "bearer-access-token", subject: grant.subject })
          .pipe(Effect.mapError(toInternal));
        const now = yield* DateTime.now;
        return {
          access_token: session.token,
          issued_token_type: AuthAccessTokenType,
          token_type: "Bearer",
          expires_in: Math.max(
            0,
            Math.floor((session.expiresAt.epochMilliseconds - now.epochMilliseconds) / 1000),
          ),
        } as const;
      }),
    issueWebSocketTicket: (session) =>
      sessions.issueWebSocketToken(session.sessionId).pipe(
        Effect.map(({ token, expiresAt }) => ({ ticket: token, expiresAt })),
        Effect.mapError(toInternal),
      ),
    authenticateHttpRequest: authenticateRequest,
    authenticateWebSocketUpgrade: (request) => {
      const ticket = Option.flatMapNullishOr(HttpServerRequest.toURL(request), (url) =>
        url.searchParams.get(WEBSOCKET_TICKET_QUERY_PARAM)?.trim(),
      ).pipe(Option.filter((value) => value.length > 0));
      return Option.isSome(ticket)
        ? verifySession(sessions.verifyWebSocketToken(ticket.value))
        : authenticateRequest(request);
    },
    issueStartupPairingUrl: (baseUrl) =>
      grants.issueOneTimeToken({ subject: "browser-pairing", purpose: "startup" }).pipe(
        Effect.map(({ credential }) => {
          const url = new URL(baseUrl);
          url.pathname = "/pair";
          url.search = "";
          url.hash = new URLSearchParams([["token", credential]]).toString();
          return url.toString();
        }),
        Effect.mapError(toInternal),
      ),
  });
});

export const layer = Layer.effect(EnvironmentAuth, make).pipe(
  Layer.provideMerge(PairingGrantStore.layer),
  Layer.provideMerge(SessionStore.layer),
);

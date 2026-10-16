import { ServerAuthSessionMethod } from "@playstead/contracts/auth";
import { AuthSessionId } from "@playstead/contracts/baseSchemas";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as AuthSessions from "../persistence/AuthSessions.ts";
import type { PersistenceError } from "../persistence/Errors.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import {
  base64UrlDecodeUtf8,
  base64UrlEncode,
  resolveSessionCookieName,
  signPayload,
  timingSafeEqualBase64Url,
} from "./utils.ts";

const SIGNING_SECRET_NAME = "server-signing-key";
const DEFAULT_SESSION_TTL = Duration.days(30);
const DEFAULT_WEBSOCKET_TOKEN_TTL = Duration.minutes(5);

/** Why a presented token was refused. */
export class SessionCredentialInvalidError extends Schema.TaggedError<SessionCredentialInvalidError>()(
  "SessionCredentialInvalidError",
  {
    reason: Schema.Literals([
      "malformed",
      "bad-signature",
      "expired",
      "unknown-session",
      "revoked",
    ]),
  },
) {
  override get message(): string {
    return `Session credential refused (${this.reason}).`;
  }
}

export class SessionStoreError extends Schema.TaggedError<SessionStoreError>()(
  "SessionStoreError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The session store failed.";
  }
}

const SessionClaims = Schema.Struct({
  v: Schema.Literal(1),
  kind: Schema.Literal("session"),
  sid: AuthSessionId,
  sub: Schema.String,
  method: ServerAuthSessionMethod,
  iat: Schema.Number,
  exp: Schema.Number,
});

const WebSocketClaims = Schema.Struct({
  v: Schema.Literal(1),
  kind: Schema.Literal("websocket"),
  sid: AuthSessionId,
  iat: Schema.Number,
  exp: Schema.Number,
});

export interface VerifiedSession {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly method: ServerAuthSessionMethod;
  readonly expiresAt: DateTime.Utc;
}

export interface IssuedSession extends VerifiedSession {
  readonly token: string;
}

/**
 * Signed session tokens, each backed by a row in `auth_sessions` so it can be
 * revoked. A WebSocket token is a short-lived ticket for one session.
 */
export class SessionStore extends Context.Service<
  SessionStore,
  {
    readonly cookieName: string;
    readonly issue: (input: {
      readonly method: ServerAuthSessionMethod;
      readonly subject: string;
    }) => Effect.Effect<IssuedSession, SessionStoreError>;
    readonly verify: (
      token: string,
    ) => Effect.Effect<VerifiedSession, SessionCredentialInvalidError | SessionStoreError>;
    readonly issueWebSocketToken: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<
      { readonly token: string; readonly expiresAt: DateTime.Utc },
      SessionStoreError
    >;
    readonly verifyWebSocketToken: (
      token: string,
    ) => Effect.Effect<VerifiedSession, SessionCredentialInvalidError | SessionStoreError>;
  }
>()("@playstead/server/auth/SessionStore") {}

const invalid = (reason: SessionCredentialInvalidError["reason"]) =>
  new SessionCredentialInvalidError({ reason });

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const config = yield* ServerConfig.ServerConfig;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const sessions = yield* AuthSessions.AuthSessionRepository;
  const signingSecret = yield* secrets.getOrCreateRandom(SIGNING_SECRET_NAME, 32);

  const sign = <S extends Schema.Codec<unknown, string>>(schema: S, claims: S["Type"]) =>
    Schema.encodeEffect(schema)(claims).pipe(
      Effect.map((json) => {
        const payload = base64UrlEncode(json);
        return `${payload}.${signPayload(payload, signingSecret)}`;
      }),
    );

  const open = <S extends Schema.Codec<unknown, string>>(schema: S, token: string) =>
    Effect.gen(function* () {
      const [payload, signature, ...rest] = token.split(".");
      if (!payload || !signature || rest.length > 0) return yield* invalid("malformed");
      if (!timingSafeEqualBase64Url(signature, signPayload(payload, signingSecret))) {
        return yield* invalid("bad-signature");
      }
      const json = base64UrlDecodeUtf8(payload);
      if (Result.isFailure(json)) return yield* invalid("malformed");
      return yield* Schema.decodeEffect(schema)(json.success).pipe(
        Effect.mapError(() => invalid("malformed")),
      );
    });

  const loadLiveSession = (sessionId: AuthSessionId, now: DateTime.Utc) =>
    sessions.getById(sessionId).pipe(
      Effect.mapError((cause: PersistenceError) => new SessionStoreError({ cause })),
      Effect.flatMap((row) => {
        if (Option.isNone(row)) return Effect.fail(invalid("unknown-session"));
        if (row.value.revokedAt !== null) return Effect.fail(invalid("revoked"));
        if (DateTime.isLessThanOrEqualTo(row.value.expiresAt, now)) {
          return Effect.fail(invalid("expired"));
        }
        return Effect.succeed({
          sessionId: row.value.sessionId,
          subject: row.value.subject,
          method: row.value.method,
          expiresAt: row.value.expiresAt,
        } satisfies VerifiedSession);
      }),
    );

  const SessionClaimsJson = Schema.fromJsonString(SessionClaims);
  const WebSocketClaimsJson = Schema.fromJsonString(WebSocketClaims);

  return SessionStore.of({
    cookieName: resolveSessionCookieName({ port: config.port, stateDir: config.stateDir }),
    issue: ({ method, subject }) =>
      Effect.gen(function* () {
        const sessionId = AuthSessionId.make(yield* crypto.randomUUIDv4());
        const issuedAt = yield* DateTime.now;
        const expiresAt = DateTime.addDuration(issuedAt, DEFAULT_SESSION_TTL);
        yield* sessions.create({ sessionId, subject, method, issuedAt, expiresAt });
        const token = yield* sign(SessionClaimsJson, {
          v: 1,
          kind: "session",
          sid: sessionId,
          sub: subject,
          method,
          iat: issuedAt.epochMilliseconds,
          exp: expiresAt.epochMilliseconds,
        });
        return { sessionId, subject, method, expiresAt, token } satisfies IssuedSession;
      }).pipe(Effect.mapError((cause) => new SessionStoreError({ cause }))),
    verify: (token) =>
      Effect.gen(function* () {
        const claims = yield* open(SessionClaimsJson, token);
        const now = yield* DateTime.now;
        if (claims.exp <= now.epochMilliseconds) return yield* invalid("expired");
        return yield* loadLiveSession(claims.sid, now);
      }),
    issueWebSocketToken: (sessionId) =>
      Effect.gen(function* () {
        const issuedAt = yield* DateTime.now;
        const expiresAt = DateTime.addDuration(issuedAt, DEFAULT_WEBSOCKET_TOKEN_TTL);
        const token = yield* sign(WebSocketClaimsJson, {
          v: 1,
          kind: "websocket",
          sid: sessionId,
          iat: issuedAt.epochMilliseconds,
          exp: expiresAt.epochMilliseconds,
        });
        return { token, expiresAt };
      }).pipe(Effect.mapError((cause) => new SessionStoreError({ cause }))),
    verifyWebSocketToken: (token) =>
      Effect.gen(function* () {
        const claims = yield* open(WebSocketClaimsJson, token);
        const now = yield* DateTime.now;
        if (claims.exp <= now.epochMilliseconds) return yield* invalid("expired");
        return yield* loadLiveSession(claims.sid, now);
      }),
  });
});

export const layer = Layer.effect(SessionStore, make).pipe(Layer.provideMerge(AuthSessions.layer));

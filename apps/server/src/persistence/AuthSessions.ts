import { ServerAuthSessionMethod } from "@playstead/contracts/auth";
import { AuthSessionId } from "@playstead/contracts/baseSchemas";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { type PersistenceError, toPersistenceError } from "./Errors.ts";

export const AuthSessionRecord = Schema.Struct({
  sessionId: AuthSessionId,
  subject: Schema.String,
  method: ServerAuthSessionMethod,
  issuedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
  revokedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type AuthSessionRecord = typeof AuthSessionRecord.Type;

const decodeRecord = Schema.decodeUnknownEffect(AuthSessionRecord);

export interface CreateAuthSessionInput {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly method: ServerAuthSessionMethod;
  readonly issuedAt: DateTime.Utc;
  readonly expiresAt: DateTime.Utc;
}

/** Signed-in clients: browser sessions behind a cookie and bearer sessions. */
export class AuthSessionRepository extends Context.Service<
  AuthSessionRepository,
  {
    readonly create: (input: CreateAuthSessionInput) => Effect.Effect<void, PersistenceError>;
    readonly getById: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<Option.Option<AuthSessionRecord>, PersistenceError>;
  }
>()("@playstead/server/persistence/AuthSessions/AuthSessionRepository") {}

const iso = DateTime.formatIso;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return AuthSessionRepository.of({
    create: (input) =>
      sql`
        INSERT INTO auth_sessions (session_id, subject, method, issued_at, expires_at)
        VALUES (
          ${input.sessionId},
          ${input.subject},
          ${input.method},
          ${iso(input.issuedAt)},
          ${iso(input.expiresAt)}
        )
      `.pipe(Effect.asVoid, Effect.mapError(toPersistenceError("auth_sessions.create"))),
    getById: (sessionId) =>
      sql`
        SELECT
          session_id AS "sessionId",
          subject AS "subject",
          method AS "method",
          issued_at AS "issuedAt",
          expires_at AS "expiresAt",
          revoked_at AS "revokedAt"
        FROM auth_sessions
        WHERE session_id = ${sessionId}
      `.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? Effect.succeedNone : Effect.asSome(decodeRecord(rows[0])),
        ),
        Effect.mapError(toPersistenceError("auth_sessions.getById")),
      ),
  });
});

export const layer = Layer.effect(AuthSessionRepository, make);

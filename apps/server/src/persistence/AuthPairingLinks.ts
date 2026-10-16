import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { type PersistenceError, toPersistenceError } from "./Errors.ts";

export const AuthPairingLinkRecord = Schema.Struct({
  id: Schema.String,
  credential: Schema.String,
  method: Schema.Literal("one-time-token"),
  subject: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
  consumedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  revokedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type AuthPairingLinkRecord = typeof AuthPairingLinkRecord.Type;

const decodeRecord = Schema.decodeUnknownEffect(AuthPairingLinkRecord);

export interface CreateAuthPairingLinkInput {
  readonly id: string;
  readonly credential: string;
  readonly subject: string;
  readonly createdAt: DateTime.Utc;
  readonly expiresAt: DateTime.Utc;
}

/** One-time pairing links, such as the one the server prints at startup. */
export class AuthPairingLinkRepository extends Context.Service<
  AuthPairingLinkRepository,
  {
    readonly create: (input: CreateAuthPairingLinkInput) => Effect.Effect<void, PersistenceError>;
    /** Marks a live link consumed and returns it, or nothing if no live link has this credential. */
    readonly consumeAvailable: (input: {
      readonly credential: string;
      readonly now: DateTime.Utc;
    }) => Effect.Effect<Option.Option<AuthPairingLinkRecord>, PersistenceError>;
  }
>()("@playstead/server/persistence/AuthPairingLinks/AuthPairingLinkRepository") {}

const iso = DateTime.formatIso;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return AuthPairingLinkRepository.of({
    create: (input) =>
      sql`
        INSERT INTO auth_pairing_links (id, credential, method, subject, created_at, expires_at)
        VALUES (
          ${input.id},
          ${input.credential},
          'one-time-token',
          ${input.subject},
          ${iso(input.createdAt)},
          ${iso(input.expiresAt)}
        )
      `.pipe(Effect.asVoid, Effect.mapError(toPersistenceError("auth_pairing_links.create"))),
    consumeAvailable: ({ credential, now }) =>
      sql`
        UPDATE auth_pairing_links
        SET consumed_at = ${iso(now)}
        WHERE credential = ${credential}
          AND revoked_at IS NULL
          AND consumed_at IS NULL
          AND expires_at > ${iso(now)}
        RETURNING
          id AS "id",
          credential AS "credential",
          method AS "method",
          subject AS "subject",
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          consumed_at AS "consumedAt",
          revoked_at AS "revokedAt"
      `.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? Effect.succeedNone : Effect.asSome(decodeRecord(rows[0])),
        ),
        Effect.mapError(toPersistenceError("auth_pairing_links.consumeAvailable")),
      ),
  });
});

export const layer = Layer.effect(AuthPairingLinkRepository, make);

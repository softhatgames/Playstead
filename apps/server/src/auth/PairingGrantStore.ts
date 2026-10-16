import type { ServerAuthBootstrapMethod } from "@playstead/contracts/auth";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as AuthPairingLinks from "../persistence/AuthPairingLinks.ts";

const ONE_TIME_TOKEN_TTL = Duration.minutes(5);
/** A development server prints its link once; it stays usable for the working day. */
const DEV_STARTUP_TTL = Duration.hours(24);
const DESKTOP_BOOTSTRAP_TTL = Duration.hours(24);
const PAIRING_TOKEN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PAIRING_TOKEN_LENGTH = 12;
// Bytes at or above this would favour the alphabet's first letters.
const PAIRING_TOKEN_REJECTION_LIMIT =
  Math.floor(256 / PAIRING_TOKEN_ALPHABET.length) * PAIRING_TOKEN_ALPHABET.length;

export interface BootstrapGrant {
  readonly method: ServerAuthBootstrapMethod;
  readonly subject: string;
}

export class BootstrapCredentialInvalidError extends Schema.TaggedError<BootstrapCredentialInvalidError>()(
  "BootstrapCredentialInvalidError",
  {},
) {
  override get message(): string {
    return "Unknown, used or expired bootstrap credential.";
  }
}

export class PairingGrantStoreError extends Schema.TaggedError<PairingGrantStoreError>()(
  "PairingGrantStoreError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The pairing grant store failed.";
  }
}

/**
 * Credentials a client exchanges for a session: one-time pairing tokens, kept
 * in `auth_pairing_links`, and the desktop app's bootstrap token, kept in
 * memory for this run.
 */
export class PairingGrantStore extends Context.Service<
  PairingGrantStore,
  {
    readonly issueOneTimeToken: (input: {
      readonly subject: string;
      readonly purpose?: "startup";
    }) => Effect.Effect<
      { readonly credential: string; readonly expiresAt: DateTime.Utc },
      PairingGrantStoreError
    >;
    readonly consume: (
      credential: string,
    ) => Effect.Effect<BootstrapGrant, BootstrapCredentialInvalidError | PairingGrantStoreError>;
  }
>()("@playstead/server/auth/PairingGrantStore") {}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const config = yield* ServerConfig.ServerConfig;
  const links = yield* AuthPairingLinks.AuthPairingLinkRepository;
  const startedAt = yield* DateTime.now;
  const desktopBootstrap =
    config.desktopBootstrapToken === undefined
      ? undefined
      : {
          credential: config.desktopBootstrapToken,
          expiresAt: DateTime.addDuration(startedAt, DESKTOP_BOOTSTRAP_TTL),
        };

  const generateToken = Effect.gen(function* () {
    let token = "";
    while (token.length < PAIRING_TOKEN_LENGTH) {
      for (const byte of yield* crypto.randomBytes(PAIRING_TOKEN_LENGTH)) {
        if (byte >= PAIRING_TOKEN_REJECTION_LIMIT) continue;
        token += PAIRING_TOKEN_ALPHABET[byte % PAIRING_TOKEN_ALPHABET.length];
        if (token.length === PAIRING_TOKEN_LENGTH) break;
      }
    }
    return token;
  });

  return PairingGrantStore.of({
    issueOneTimeToken: ({ subject, purpose }) =>
      Effect.gen(function* () {
        const id = yield* crypto.randomUUIDv4();
        const credential = yield* generateToken;
        const createdAt = yield* DateTime.now;
        const ttl =
          purpose === "startup" && config.devUrl !== undefined
            ? DEV_STARTUP_TTL
            : ONE_TIME_TOKEN_TTL;
        const expiresAt = DateTime.addDuration(createdAt, ttl);
        yield* links.create({ id, credential, subject, createdAt, expiresAt });
        return { credential, expiresAt };
      }).pipe(Effect.mapError((cause) => new PairingGrantStoreError({ cause }))),
    consume: (credential) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        // The desktop app's token has unbounded uses, so the window can sign in
        // again after a reload.
        if (
          desktopBootstrap !== undefined &&
          desktopBootstrap.credential === credential &&
          DateTime.isLessThan(now, desktopBootstrap.expiresAt)
        ) {
          return { method: "desktop-bootstrap", subject: "desktop-bootstrap" } as const;
        }
        const consumed = yield* links
          .consumeAvailable({ credential, now })
          .pipe(Effect.mapError((cause) => new PairingGrantStoreError({ cause })));
        if (Option.isNone(consumed)) return yield* new BootstrapCredentialInvalidError({});
        return { method: consumed.value.method, subject: consumed.value.subject } as const;
      }),
  });
});

export const layer = Layer.effect(PairingGrantStore, make).pipe(
  Layer.provideMerge(AuthPairingLinks.layer),
);

// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no HMAC or timingSafeEqual.
import * as NodeCrypto from "node:crypto";

import * as Base64Url from "effect/encoding/Base64Url";
import * as Result from "effect/Result";

const SESSION_COOKIE_NAME = "playstead_session";

/**
 * Cookies are scoped by host, not by port, so two servers on 127.0.0.1 (a
 * worktree's and the main checkout's, say) need different names, or each
 * overwrites the other's session.
 */
export function resolveSessionCookieName(input: {
  readonly port: number;
  readonly stateDir: string;
}): string {
  const instanceHash = NodeCrypto.createHash("sha256")
    .update(input.stateDir)
    .digest("hex")
    .slice(0, 12);
  return `${SESSION_COOKIE_NAME}_${input.port}_${instanceHash}`;
}

export function base64UrlEncode(input: string): string {
  return Base64Url.encode(new TextEncoder().encode(input));
}

export function base64UrlDecodeUtf8(input: string): Result.Result<string, unknown> {
  return Base64Url.decodeString(input);
}

export function signPayload(payload: string, secret: Uint8Array): string {
  return NodeCrypto.createHmac("sha256", Buffer.from(secret)).update(payload).digest("base64url");
}

export function timingSafeEqualBase64Url(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "base64url");
  const rightBuffer = Buffer.from(right, "base64url");
  return (
    leftBuffer.length === rightBuffer.length && NodeCrypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

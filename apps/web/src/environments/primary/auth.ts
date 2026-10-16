import { AuthSessionState } from "@playstead/contracts/auth";
import * as Schema from "effect/Schema";

import { getPairingTokenFromUrl, stripPairingTokenFromUrl } from "../../pairingUrl.ts";

const decodeSessionState = Schema.decodeUnknownPromise(AuthSessionState);

/** Whether this browser already has a session with the server. */
export async function fetchSessionState(): Promise<AuthSessionState> {
  const response = await fetch("/api/auth/session", { credentials: "same-origin" });
  if (!response.ok) throw new Error(`The server answered ${response.status} to a session check.`);
  return decodeSessionState(await response.json());
}

export type PairingResult =
  | { readonly _tag: "Paired" }
  | { readonly _tag: "MissingToken" }
  | { readonly _tag: "Rejected" };

/**
 * Trades the pairing link's one-time token for a session cookie, then takes
 * the token out of the address so it is not left in history.
 */
export async function exchangePairingLink(location: URL): Promise<PairingResult> {
  const token = getPairingTokenFromUrl(location);
  window.history.replaceState(null, "", stripPairingTokenFromUrl(location).toString());
  if (token === undefined) return { _tag: "MissingToken" };
  const response = await fetch("/api/auth/browser-session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential: token }),
  });
  if (response.status === 401) return { _tag: "Rejected" };
  if (!response.ok) throw new Error(`The server answered ${response.status} to the pairing link.`);
  return { _tag: "Paired" };
}

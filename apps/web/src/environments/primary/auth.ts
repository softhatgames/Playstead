import type { AuthSessionState } from "@playstead/contracts/auth";
import { fetchSessionState, signInWithPairingToken } from "@playstead/client-runtime/auth";

import { runtime } from "../../connection/runtime.ts";
import { makePairingExchange } from "../../pairingExchange.ts";

const primaryTarget = () => ({ httpBaseUrl: window.location.origin });

/** Whether this browser already has a session with the server. */
export const fetchPrimarySessionState = (): Promise<AuthSessionState> =>
  runtime.runPromise(fetchSessionState(primaryTarget()));

/** Signs this browser in with the pairing link it was opened from. */
export const exchangePairingLink = makePairingExchange({
  currentUrl: () => new URL(window.location.href),
  replaceUrl: (url) => window.history.replaceState(window.history.state, "", url.toString()),
  signIn: (token) => runtime.runPromise(signInWithPairingToken(primaryTarget(), token)),
});

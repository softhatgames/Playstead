import type { AuthSessionState } from "@playstead/contracts/auth";
import { fetchSessionState, signInWithPairingToken } from "@playstead/client-runtime/auth";

import { runtime } from "../../connection/runtime.ts";
import { makePairingExchange } from "../../pairingExchange.ts";
import { makeSessionWait } from "../../sessionWait.ts";

const primaryTarget = () => ({ httpBaseUrl: window.location.origin });

/** Whether the page's session checks are waiting for the server to come back. */
export const primarySessionWait = makeSessionWait();

/** Whether this browser already has a session with the server, waiting for it while it is down. */
export const fetchPrimarySessionState = (): Promise<AuthSessionState> =>
  primarySessionWait.track((onWaiting) =>
    runtime.runPromise(fetchSessionState(primaryTarget(), { onWaiting })),
  );

/** Signs this browser in with the pairing link it was opened from. */
export const exchangePairingLink = makePairingExchange({
  currentUrl: () => new URL(window.location.href),
  replaceUrl: (url) => window.history.replaceState(window.history.state, "", url.toString()),
  signIn: (token) => runtime.runPromise(signInWithPairingToken(primaryTarget(), token)),
});

import { useSyncExternalStore } from "react";

import { APP_DISPLAY_NAME } from "../branding.ts";
import { isElectron } from "../env.ts";
import { fetchPrimarySessionState, primarySessionWait } from "../environments/primary/auth.ts";
import { describeSessionWait } from "../sessionWait.ts";

/** Whether this page may talk to the server; the desktop app signs its window in itself. */
export const loadSignedIn = () =>
  isElectron ? Promise.resolve({ authenticated: true }) : fetchPrimarySessionState();

export function NotSignedIn() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">{APP_DISPLAY_NAME}</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        This browser is not signed in. Open the pairing link the server printed when it started.
      </p>
    </main>
  );
}

/**
 * Shown while a page waits for its session check, where T3 Code shows its
 * splash (`apps/web/index.html` at 2577baf); this one also says when the
 * server is not answering and the page is reconnecting.
 */
export function WaitingForServer() {
  const waiting = useSyncExternalStore(
    primarySessionWait.subscribe,
    primarySessionWait.isWaiting,
    primarySessionWait.isWaiting,
  );
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">{APP_DISPLAY_NAME}</h1>
      <p role="status" className="text-sm text-neutral-600 dark:text-neutral-300">
        {describeSessionWait(waiting)}
      </p>
    </main>
  );
}

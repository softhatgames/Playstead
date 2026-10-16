import { APP_DISPLAY_NAME } from "../branding.ts";
import { isElectron } from "../env.ts";
import { fetchPrimarySessionState } from "../environments/primary/auth.ts";

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

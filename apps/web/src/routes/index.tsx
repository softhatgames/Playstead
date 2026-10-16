import { createFileRoute } from "@tanstack/react-router";

import { APP_DISPLAY_NAME } from "../branding.ts";
import { EnvironmentStatus } from "../components/EnvironmentStatus.tsx";
import { fetchPrimarySessionState } from "../environments/primary/auth.ts";

function HomeView() {
  const session = Route.useLoaderData();
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">{APP_DISPLAY_NAME}</h1>
      {session.authenticated ? (
        <EnvironmentStatus />
      ) : (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          This browser is not signed in. Open the pairing link the server printed when it started.
        </p>
      )}
    </main>
  );
}

export const Route = createFileRoute("/")({
  loader: () => fetchPrimarySessionState(),
  component: HomeView,
});

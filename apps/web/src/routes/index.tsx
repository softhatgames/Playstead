import { Link, createFileRoute } from "@tanstack/react-router";

import { APP_DISPLAY_NAME } from "../branding.ts";
import { AppSidebarLayout } from "../components/AppSidebarLayout.tsx";
import { EnvironmentStatus } from "../components/EnvironmentStatus.tsx";
import { isElectron } from "../env.ts";
import { fetchPrimarySessionState } from "../environments/primary/auth.ts";

function HomeView() {
  const session = Route.useLoaderData();
  if (!session.authenticated) {
    return (
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-semibold">{APP_DISPLAY_NAME}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          This browser is not signed in. Open the pairing link the server printed when it started.
        </p>
      </main>
    );
  }
  return (
    <AppSidebarLayout>
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
        <EnvironmentStatus />
        <Link to="/settings/providers" className="text-sm underline">
          Settings
        </Link>
      </main>
    </AppSidebarLayout>
  );
}

export const Route = createFileRoute("/")({
  // The desktop app signs its window in itself.
  loader: () => (isElectron ? { authenticated: true } : fetchPrimarySessionState()),
  component: HomeView,
});

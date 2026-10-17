import { Link, createFileRoute } from "@tanstack/react-router";

import { AppSidebarLayout } from "../components/AppSidebarLayout.tsx";
import { EnvironmentStatus } from "../components/EnvironmentStatus.tsx";
import { NoProjectsHero } from "../components/NoProjectsHero.tsx";
import { loadSignedIn, NotSignedIn } from "../components/SignedInGate.tsx";
import { usePrimaryConnectionState } from "../connection/runtime.ts";

function HomeView() {
  const session = Route.useLoaderData();
  const shell = usePrimaryConnectionState()?.shell;
  if (!session.authenticated) return <NotSignedIn />;
  return (
    <AppSidebarLayout>
      {shell !== undefined && shell.projects.length === 0 ? <NoProjectsHero /> : null}
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
  loader: loadSignedIn,
  component: HomeView,
});

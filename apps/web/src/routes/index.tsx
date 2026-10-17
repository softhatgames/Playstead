import { Link, createFileRoute } from "@tanstack/react-router";

import { AppSidebarLayout } from "../components/AppSidebarLayout.tsx";
import { EnvironmentStatus } from "../components/EnvironmentStatus.tsx";
import { loadSignedIn, NotSignedIn } from "../components/SignedInGate.tsx";

function HomeView() {
  const session = Route.useLoaderData();
  if (!session.authenticated) return <NotSignedIn />;
  return (
    <AppSidebarLayout>
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
        <EnvironmentStatus />
        <Link to="/settings/general" className="text-sm underline">
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

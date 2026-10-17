import { useScratchProject } from "../hooks/useScratchProject.ts";
import { usePrimaryConnectionState } from "../connection/runtime.ts";
import { openCommandPalette } from "../commandPaletteBus.ts";
import { Link, createFileRoute } from "@tanstack/react-router";

import { AppSidebarLayout } from "../components/AppSidebarLayout.tsx";
import { EnvironmentStatus } from "../components/EnvironmentStatus.tsx";
import { loadSignedIn, NotSignedIn } from "../components/SignedInGate.tsx";

function HomeView() {
  const session = Route.useLoaderData();
  const state = usePrimaryConnectionState();
  const { scratchWorkspaceRoot, startScratchThread } = useScratchProject();
  if (!session.authenticated) return <NotSignedIn />;
  return (
    <AppSidebarLayout>
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
        {state?.shell?.projects.length === 0 ? (
          <section className="flex flex-col gap-4">
            <h1 className="text-2xl font-medium">What should we work on?</h1>
            <p>
              {scratchWorkspaceRoot
                ? "Add a project, or start without one."
                : "Add a project to start your first thread."}
            </p>
            <div className="flex gap-4">
              <button
                type="button"
                className="rounded border px-3 py-2"
                onClick={() => openCommandPalette({ open: "add-project" })}
              >
                Add project
              </button>
              {scratchWorkspaceRoot ? (
                <button
                  type="button"
                  className="rounded border px-3 py-2"
                  onClick={() => void startScratchThread()}
                >
                  Start without a project
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
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

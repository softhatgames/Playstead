import { Link, Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

import { fetchPrimarySessionState } from "../environments/primary/auth.ts";

/** The pages Playstead has, in T3 Code's order (`SettingsSidebarNav.tsx`). */
const SETTINGS_PAGES = [
  { to: "/settings/general", label: "General" },
  { to: "/settings/providers", label: "Providers" },
  { to: "/settings/archived", label: "Archive" },
] as const;

/**
 * Opens the page at the row the URL's hash names, as the command palette's
 * settings search asks (T3 Code's settings rows scroll into view by hash):
 * unfolding a folded section such as **Legacy features** around it first.
 * The page's rows can render after the route, so it looks again on the next
 * frame when the row is not there yet.
 */
function useScrollToSettingsRow() {
  const hash = useLocation({ select: (location) => location.hash });
  useEffect(() => {
    if (hash === "") return;
    let frame = 0;
    let attempts = 0;
    const reveal = () => {
      const row = document.getElementById(hash);
      if (row === null) {
        if (attempts++ < 30) frame = window.requestAnimationFrame(reveal);
        return;
      }
      const details = row.closest("details");
      if (details !== null) details.open = true;
      row.scrollIntoView({ block: "center" });
    };
    reveal();
    return () => window.cancelAnimationFrame(frame);
  }, [hash]);
}

/**
 * Settings, after T3 Code's `apps/web/src/routes/settings.tsx` at 2577baf:
 * **General**, **Providers** and **Archive**; `/settings` opens General.
 */
function SettingsLayout() {
  const session = Route.useLoaderData();
  useScrollToSettingsRow();
  return (
    <div className="mx-auto flex max-w-3xl gap-8 px-6 py-10">
      <nav aria-label="Settings" className="flex w-40 shrink-0 flex-col gap-1 text-sm">
        <Link to="/" className="mb-4 text-neutral-500 hover:underline dark:text-neutral-400">
          ← Back
        </Link>
        {SETTINGS_PAGES.map((page) => (
          <Link
            key={page.to}
            to={page.to}
            className="rounded-md px-2 py-1"
            activeProps={{ className: "bg-neutral-100 font-medium dark:bg-neutral-900" }}
          >
            {page.label}
          </Link>
        ))}
      </nav>
      <main className="min-w-0 flex-1">
        {session.authenticated ? (
          <Outlet />
        ) : (
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            This browser is not signed in. Open the pairing link the server printed when it started.
          </p>
        )}
      </main>
    </div>
  );
}

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/settings" || location.pathname === "/settings/") {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  loader: () => fetchPrimarySessionState(),
  component: SettingsLayout,
});

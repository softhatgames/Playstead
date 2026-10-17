import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * A project's settings by its key (T3 Code's `apps/web/src/routes/projects.$projectKey.tsx`
 * at 2577baf): it opens **Settings → Projects** on that project. The key is
 * the project's id, as the sidebar groups one project each.
 */
export const Route = createFileRoute("/projects/$projectKey")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/settings/projects",
      search: { project: params.projectKey },
      replace: true,
    });
  },
});

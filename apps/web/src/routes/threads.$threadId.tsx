import { ThreadId } from "@playstead/contracts/baseSchemas";
import { createFileRoute } from "@tanstack/react-router";

import { AppSidebarLayout } from "../components/AppSidebarLayout.tsx";
import { ChatView } from "../components/chat/ChatView.tsx";
import { loadSignedIn, NotSignedIn } from "../components/SignedInGate.tsx";

/** A thread on the server (T3 Code's `_chat.$environmentId.$threadId.tsx` at 2577baf, one environment). */
function ThreadRouteView() {
  const session = Route.useLoaderData();
  const { threadId } = Route.useParams();
  if (!session.authenticated) return <NotSignedIn />;
  return (
    <AppSidebarLayout>
      <ChatView key={threadId} kind="thread" threadId={ThreadId.make(threadId)} />
    </AppSidebarLayout>
  );
}

export const Route = createFileRoute("/threads/$threadId")({
  loader: loadSignedIn,
  component: ThreadRouteView,
});

import { createFileRoute } from "@tanstack/react-router";

import { AppSidebarLayout } from "../components/AppSidebarLayout.tsx";
import { ChatView } from "../components/chat/ChatView.tsx";
import { loadSignedIn, NotSignedIn } from "../components/SignedInGate.tsx";
import { useDraft } from "../drafts.ts";

/** A new thread before its first message (T3 Code's `_chat.draft.$draftId.tsx` at 2577baf). */
function DraftRouteView() {
  const session = Route.useLoaderData();
  const { draftId } = Route.useParams();
  const draft = useDraft(draftId);
  if (!session.authenticated) return <NotSignedIn />;
  return (
    <AppSidebarLayout>
      {draft === undefined ? (
        <p className="px-6 py-6 text-sm text-neutral-600 dark:text-neutral-300">
          This new thread is gone. Start another from the sidebar.
        </p>
      ) : (
        <ChatView key={draftId} kind="draft" draft={draft} />
      )}
    </AppSidebarLayout>
  );
}

export const Route = createFileRoute("/draft/$draftId")({
  loader: loadSignedIn,
  component: DraftRouteView,
});

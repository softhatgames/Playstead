import { createFileRoute } from "@tanstack/react-router";

import { ArchivedThreadsPanel } from "../components/settings/SettingsPanels.tsx";

export const Route = createFileRoute("/settings/archived")({
  component: ArchivedThreadsPanel,
});

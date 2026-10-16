import { createFileRoute } from "@tanstack/react-router";

import { ProviderSettingsPanel } from "../components/settings/ProviderSettingsPanel.tsx";

export const Route = createFileRoute("/settings/providers")({
  component: ProviderSettingsPanel,
});

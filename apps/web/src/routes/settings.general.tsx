import { createFileRoute } from "@tanstack/react-router";

import { GeneralSettingsPanel } from "../components/settings/GeneralSettingsPanel.tsx";

export const Route = createFileRoute("/settings/general")({
  component: GeneralSettingsPanel,
});

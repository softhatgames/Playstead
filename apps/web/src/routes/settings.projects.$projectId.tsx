import { createFileRoute } from "@tanstack/react-router";
import { ProjectSettingsPanel } from "../components/settings/ProjectSettingsPanel.tsx";

export const Route = createFileRoute("/settings/projects/$projectId")({
  component: ProjectSettingsRoute,
});
function ProjectSettingsRoute() {
  return <ProjectSettingsPanel projectId={Route.useParams().projectId} />;
}

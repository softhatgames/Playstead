import { createFileRoute } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ProjectSettingsPanel } from "../components/settings/ProjectSettingsPanel.tsx";

const ProjectsSearch = Schema.Struct({ project: Schema.optionalKey(Schema.String) });
const decodeSearch = Schema.decodeUnknownOption(ProjectsSearch);

function ProjectsSettings() {
  const { project } = Route.useSearch();
  return <ProjectSettingsPanel projectKey={project ?? null} />;
}

/** **Settings → Projects** (T3 Code's `routes/settings.projects.tsx`): one project's settings. */
export const Route = createFileRoute("/settings/projects")({
  validateSearch: (search: Record<string, unknown>): typeof ProjectsSearch.Type =>
    Option.getOrElse(decodeSearch(search), () => ({})),
  component: ProjectsSettings,
});

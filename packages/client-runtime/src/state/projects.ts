import {
  normalizeProjectPathForComparison,
  normalizeProjectPathForDispatch,
} from "@playstead/shared/path";

import { splitAbsolutePath } from "./paths.ts";

/**
 * The project already added for a folder, if any, so Add project opens it
 * instead of asking the server to add it again (T3 Code's `findProjectByPath`
 * in `packages/client-runtime/src/state/projects.ts` at 2577baf).
 */
export const findProjectByPath = <P extends { readonly workspaceRoot: string }>(
  projects: ReadonlyArray<P>,
  candidatePath: string,
): P | undefined => {
  const candidate = normalizeProjectPathForComparison(candidatePath);
  if (candidate.length === 0) return undefined;
  return projects.find(
    (project) => normalizeProjectPathForComparison(project.workspaceRoot) === candidate,
  );
};

/** A new project's title: its folder's name. */
export const inferProjectTitleFromPath = (value: string): string => {
  const normalized = normalizeProjectPathForDispatch(value);
  const segments = splitAbsolutePath(normalized)?.segments ?? normalized.split(/[/\\]/);
  return segments.findLast((segment) => segment.length > 0) ?? normalized;
};

/** Managed scratch uses its configured path, never its editable display title. */
export const isScratchProject = (
  project: { readonly workspaceRoot: string },
  scratchWorkspaceRoot: string | undefined,
): boolean =>
  scratchWorkspaceRoot !== undefined &&
  normalizeProjectPathForComparison(project.workspaceRoot) ===
    normalizeProjectPathForComparison(scratchWorkspaceRoot);

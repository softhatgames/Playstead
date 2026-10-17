import {
  findProjectByPath,
  inferProjectTitleFromPath,
} from "@playstead/client-runtime/state/projects";
import {
  isExplicitRelativePath,
  isWindowsAbsolutePath,
  normalizeProjectPathForDispatch,
} from "@playstead/shared/path";

export type AddProjectPlan =
  | { readonly kind: "none" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "open"; readonly projectId: string }
  | { readonly kind: "create"; readonly workspaceRoot: string; readonly title: string };

/**
 * What Add project does with a folder path, as T3 Code's
 * `handleAddProjectForEnvironment` in `apps/web/src/components/CommandPalette.tsx`
 * at 2577baf decides it: a folder a project already has opens that project,
 * and any other folder becomes a new project named after it. The server
 * still checks the folder and answers a conflict with its owner, for paths
 * spelled differently (such as `~/…`).
 */
export function planAddProject(input: {
  readonly rawPath: string;
  /** The server's platform, from its environment descriptor. */
  readonly platform: string;
  readonly projects: ReadonlyArray<{ readonly id: string; readonly workspaceRoot: string }>;
}): AddProjectPlan {
  const trimmed = input.rawPath.trim();
  if (isWindowsAbsolutePath(trimmed) && !/^win/i.test(input.platform)) {
    return { kind: "error", message: "Windows-style paths are only supported on Windows." };
  }
  // A relative path starts from the active project, and none is open yet.
  if (isExplicitRelativePath(trimmed)) {
    return { kind: "error", message: "Relative paths require an active project." };
  }
  const workspaceRoot = normalizeProjectPathForDispatch(trimmed);
  if (workspaceRoot.length === 0) return { kind: "none" };
  const existing = findProjectByPath(input.projects, workspaceRoot);
  if (existing !== undefined) return { kind: "open", projectId: existing.id };
  return { kind: "create", workspaceRoot, title: inferProjectTitleFromPath(workspaceRoot) };
}

import { isUncPath, isWindowsDrivePath } from "@playstead/shared/path";

/**
 * Splitting typed folder paths for Add project, after T3 Code's helpers in
 * `packages/client-runtime/src/state/projects.ts` at 2577baf. The server may
 * run on another platform than the interface, so the path's own form decides
 * its separator: `/…` is POSIX, `C:\…` and `\\server\share\…` are Windows,
 * and anything else (such as `~/…`) uses whichever separator it contains.
 */

type PathKind = "posix" | "windows" | "other";

const pathKind = (value: string): PathKind =>
  value.startsWith("/")
    ? "posix"
    : isWindowsDrivePath(value) || isUncPath(value)
      ? "windows"
      : "other";

export const preferredSeparator = (value: string): "/" | "\\" => {
  const kind = pathKind(value);
  if (kind === "windows") return "\\";
  if (kind === "posix") return "/";
  return value.includes("\\") ? "\\" : "/";
};

export const hasTrailingPathSeparator = (value: string): boolean =>
  pathKind(value) === "posix" ? value.endsWith("/") : /[/\\]$/.test(value);

const lastSeparatorIndex = (value: string): number =>
  pathKind(value) === "posix"
    ? value.lastIndexOf("/")
    : Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));

/** Root and folder names of an absolute path; null for any other path. */
export const splitAbsolutePath = (
  value: string,
): {
  readonly root: string;
  readonly separator: "/" | "\\";
  readonly segments: string[];
} | null => {
  const kind = pathKind(value);
  if (kind === "posix") {
    return { root: "/", separator: "/", segments: value.split("/").filter(Boolean) };
  }
  if (kind !== "windows") return null;
  if (isWindowsDrivePath(value)) {
    const segments = value
      .slice(2)
      .split(/[/\\]+/)
      .filter(Boolean);
    return { root: `${value.slice(0, 2)}\\`, separator: "\\", segments };
  }
  const [server, share, ...segments] = value.split(/[/\\]+/).filter(Boolean);
  if (server === undefined || share === undefined) return null;
  return { root: `\\\\${server}\\${share}\\`, separator: "\\", segments };
};

/** The folder part of a typed path, up to and including its last separator. */
export const getBrowseDirectoryPath = (value: string): string => {
  if (hasTrailingPathSeparator(value)) return value;
  const index = lastSeparatorIndex(value);
  return index < 0 ? value : value.slice(0, index + 1);
};

/** What follows the last separator: the partly typed folder name. */
export const getBrowseLeafPathSegment = (value: string): string =>
  value.slice(lastSeparatorIndex(value) + 1);

/** The folder above a folder path, with a trailing separator; null at a root. */
export const getBrowseParentPath = (directoryPath: string): string | null => {
  const trimmed = directoryPath.trim();
  const absolute = splitAbsolutePath(trimmed);
  if (absolute !== null) {
    if (absolute.segments.length === 0) return null;
    const parent = absolute.segments.slice(0, -1);
    return parent.length === 0
      ? absolute.root
      : `${absolute.root}${parent.join(absolute.separator)}${absolute.separator}`;
  }
  const withoutTrailing = trimmed.replace(/[/\\]+$/, "");
  const index = lastSeparatorIndex(withoutTrailing);
  return index < 0 ? null : withoutTrailing.slice(0, index + 1);
};

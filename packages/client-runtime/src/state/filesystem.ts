import type { FilesystemBrowseEntry } from "@playstead/contracts/filesystem";
import { isWindowsAbsolutePath } from "@playstead/shared/path";

import {
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  hasTrailingPathSeparator,
  preferredSeparator,
} from "./paths.ts";

/**
 * Add project's path autocompletion, after T3 Code's
 * `packages/client-runtime/src/state/filesystem.ts` at 2577baf: the palette
 * asks the server for the typed path's folder and filters the answer by the
 * partly typed name itself, so typing within one folder needs no new request.
 */

/** The server's platform, as its environment descriptor names it. */
const isWindowsServer = (platform: string) => /^win/i.test(platform);

/** Whether typed text is a path to browse rather than words. */
const isFilesystemBrowseQuery = (query: string, platform: string): boolean =>
  /^(\.{1,2}[/\\]|\/|~\/)/.test(query) ||
  (isWindowsServer(platform) && isWindowsAbsolutePath(query));

export interface FilesystemBrowsePath {
  readonly isBrowsing: boolean;
  /** The folder to ask the server for, with a trailing separator. */
  readonly directoryPath: string;
  /** The partly typed name inside it. */
  readonly filterQuery: string;
  readonly canBrowseUp: boolean;
}

export const getFilesystemBrowsePath = (query: string, platform: string): FilesystemBrowsePath => {
  if (!isFilesystemBrowseQuery(query, platform)) {
    return { isBrowsing: false, directoryPath: "", filterQuery: "", canBrowseUp: false };
  }
  const directoryPath = getBrowseDirectoryPath(query);
  return {
    isBrowsing: true,
    directoryPath,
    filterQuery: hasTrailingPathSeparator(query) ? "" : getBrowseLeafPathSegment(query),
    canBrowseUp: getBrowseParentPath(directoryPath) !== null,
  };
};

/**
 * The folders whose names start with the filter, ignoring case. Hidden
 * folders show only once the filter starts with a dot.
 */
export const filterFilesystemBrowseEntries = (
  entries: ReadonlyArray<FilesystemBrowseEntry>,
  filterQuery: string,
): {
  readonly visibleEntries: ReadonlyArray<FilesystemBrowseEntry>;
  readonly exactEntry: FilesystemBrowseEntry | null;
} => {
  const lower = filterQuery.toLowerCase();
  const showHidden = filterQuery.startsWith(".");
  const visibleEntries = entries.filter(
    (entry) =>
      entry.name.toLowerCase().startsWith(lower) && (showHidden || !entry.name.startsWith(".")),
  );
  const exactEntry =
    filterQuery.length === 0
      ? null
      : (visibleEntries.find((entry) => entry.name === filterQuery) ?? null);
  return { visibleEntries, exactEntry };
};

/** The typed path with a listed folder opened, ready to browse inside it. */
export const appendBrowsePathSegment = (currentPath: string, name: string): string =>
  `${getBrowseDirectoryPath(currentPath)}${name}${preferredSeparator(currentPath)}`;

export const getBrowseUpPath = (directoryPath: string): string | null =>
  getBrowseParentPath(directoryPath);

/**
 * The folder Enter adds: the listed folder when the path ends with a
 * separator, the listed folder the last segment names exactly, or else the
 * path as typed, which the server resolves and creates if missing.
 */
export const resolveAddProjectPath = (
  query: string,
  listedParentPath: string | undefined,
  exactEntry: FilesystemBrowseEntry | null,
): string =>
  hasTrailingPathSeparator(query)
    ? (listedParentPath ?? query.trim())
    : (exactEntry?.fullPath ?? query.trim());

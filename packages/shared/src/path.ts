/**
 * Path strings as both the server and the interface read them, whatever the
 * host they run on (T3 Code's `packages/shared/src/path.ts` at 2577baf). The
 * interface may show a Windows server's paths on a Mac, so nothing here uses
 * the local platform's path module.
 */

/** `C:`, `C:\` or `C:/…`. */
export const isWindowsDrivePath = (value: string): boolean => /^[a-zA-Z]:([/\\]|$)/.test(value);

/** `\\server\share…`. */
export const isUncPath = (value: string): boolean => value.startsWith("\\\\");

export const isWindowsAbsolutePath = (value: string): boolean =>
  isWindowsDrivePath(value) || isUncPath(value);

/** `.`, `..`, or a path starting with either and a separator. */
export const isExplicitRelativePath = (value: string): boolean => /^\.\.?([/\\]|$)/.test(value);

const isRootPath = (value: string): boolean =>
  value === "/" || value === "\\" || /^[a-zA-Z]:[/\\]$/.test(value);

/**
 * Drops trailing separators but keeps a root as it is. A bare drive (`C:`)
 * means the current folder on that drive, so it becomes the drive's root.
 */
const trimTrailingSeparators = (value: string): string => {
  if (value.length === 0 || isRootPath(value)) return value;
  const trimmed = value.replace(value.startsWith("/") ? /\/+$/ : /[/\\]+$/, "");
  if (trimmed.length === 0) return value;
  return /^[a-zA-Z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed;
};

/** The path a project is created with: trimmed, without a trailing separator. */
export const normalizeProjectPathForDispatch = (value: string): string =>
  trimTrailingSeparators(value.trim());

/** Windows paths compare without case and with one kind of separator. */
export const normalizeProjectPathForComparison = (value: string): string => {
  const normalized = normalizeProjectPathForDispatch(value);
  return isWindowsAbsolutePath(normalized)
    ? normalized.replaceAll("/", "\\").toLowerCase()
    : normalized;
};

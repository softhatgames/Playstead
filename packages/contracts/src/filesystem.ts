import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Browsing the server's folders, for Add project's path autocompletion
 * (T3 Code's `packages/contracts/src/filesystem.ts` at 2577baf, browse only).
 */

const FILESYSTEM_PATH_MAX_LENGTH = 512;

const FilesystemPath = TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH));

export const FilesystemBrowseInput = Schema.Struct({
  partialPath: FilesystemPath,
  /** The folder a relative `partialPath` starts from. */
  cwd: Schema.optionalKey(FilesystemPath),
});
export type FilesystemBrowseInput = typeof FilesystemBrowseInput.Type;

export const FilesystemBrowseEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  fullPath: TrimmedNonEmptyString,
});
export type FilesystemBrowseEntry = typeof FilesystemBrowseEntry.Type;

export const FilesystemBrowseResult = Schema.Struct({
  parentPath: TrimmedNonEmptyString,
  entries: Schema.Array(FilesystemBrowseEntry),
});
export type FilesystemBrowseResult = typeof FilesystemBrowseResult.Type;

const FilesystemBrowseFailure = Schema.Literals([
  "windows_path_unsupported",
  "current_project_required",
  "read_directory_failed",
]);
export type FilesystemBrowseFailure = typeof FilesystemBrowseFailure.Type;

export class FilesystemBrowseError extends Schema.TaggedError<FilesystemBrowseError>()(
  "FilesystemBrowseError",
  {
    partialPath: Schema.String,
    failure: FilesystemBrowseFailure,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

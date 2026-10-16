import { assert, describe, it } from "@effect/vitest";

import {
  appendBrowsePathSegment,
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
  resolveAddProjectPath,
} from "./filesystem.ts";

const entry = (name: string, parent = "/Users/me") => ({ name, fullPath: `${parent}/${name}` });

describe("getFilesystemBrowsePath", () => {
  it("browses the typed folder and filters by the last segment", () => {
    assert.deepStrictEqual(getFilesystemBrowsePath("~/games/sp", "darwin"), {
      isBrowsing: true,
      directoryPath: "~/games/",
      filterQuery: "sp",
      canBrowseUp: true,
    });
  });

  it("lists a whole folder when the path ends with a separator", () => {
    assert.deepStrictEqual(getFilesystemBrowsePath("/Users/me/", "darwin"), {
      isBrowsing: true,
      directoryPath: "/Users/me/",
      filterQuery: "",
      canBrowseUp: true,
    });
    assert.isFalse(getFilesystemBrowsePath("/", "darwin").canBrowseUp);
  });

  it("does not browse text that is not a path", () => {
    assert.isFalse(getFilesystemBrowsePath("my game", "darwin").isBrowsing);
    assert.isFalse(getFilesystemBrowsePath("C:\\Users\\", "darwin").isBrowsing);
  });

  it("browses Windows paths on a Windows server", () => {
    assert.deepStrictEqual(getFilesystemBrowsePath("C:\\Users\\me\\Doc", "windows"), {
      isBrowsing: true,
      directoryPath: "C:\\Users\\me\\",
      filterQuery: "Doc",
      canBrowseUp: true,
    });
  });
});

describe("filterFilesystemBrowseEntries", () => {
  const entries = [entry(".config"), entry("Games"), entry("games-old"), entry("music")];

  it("keeps names starting with the filter, ignoring case, and hides dot folders", () => {
    const { visibleEntries, exactEntry } = filterFilesystemBrowseEntries(entries, "gam");
    assert.deepStrictEqual(
      visibleEntries.map((visible) => visible.name),
      ["Games", "games-old"],
    );
    assert.isNull(exactEntry);
    assert.deepStrictEqual(
      filterFilesystemBrowseEntries(entries, "").visibleEntries.map((visible) => visible.name),
      ["Games", "games-old", "music"],
    );
    assert.deepStrictEqual(
      filterFilesystemBrowseEntries(entries, ".").visibleEntries.map((visible) => visible.name),
      [".config"],
    );
  });

  it("finds the folder the filter names exactly", () => {
    assert.deepStrictEqual(
      filterFilesystemBrowseEntries(entries, "Games").exactEntry,
      entry("Games"),
    );
  });
});

describe("appendBrowsePathSegment", () => {
  it("opens a folder from the list", () => {
    assert.strictEqual(appendBrowsePathSegment("~/ga", "games"), "~/games/");
    assert.strictEqual(appendBrowsePathSegment("C:\\Users\\", "me"), "C:\\Users\\me\\");
  });
});

describe("resolveAddProjectPath", () => {
  it("adds the listed folder when the path ends with a separator", () => {
    assert.strictEqual(
      resolveAddProjectPath("~/games/", "/Users/me/games", null),
      "/Users/me/games",
    );
  });

  it("adds the folder the last segment names exactly, or the typed path", () => {
    assert.strictEqual(
      resolveAddProjectPath("~/Games", "/Users/me", entry("Games")),
      "/Users/me/Games",
    );
    assert.strictEqual(resolveAddProjectPath(" ~/new-game ", "/Users/me", null), "~/new-game");
  });
});

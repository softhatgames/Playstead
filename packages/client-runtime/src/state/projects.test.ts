import { assert, describe, it } from "@effect/vitest";

import { findProjectByPath, inferProjectTitleFromPath } from "./projects.ts";

const projects = [
  { id: "mac", workspaceRoot: "/Users/me/games/space" },
  { id: "windows", workspaceRoot: "C:\\Users\\me\\Games\\Space" },
];

describe("findProjectByPath", () => {
  it("finds the project for a folder however its trailing separator is written", () => {
    assert.strictEqual(findProjectByPath(projects, "/Users/me/games/space/")?.id, "mac");
    assert.strictEqual(findProjectByPath(projects, "/Users/me/games/Space"), undefined);
  });

  it("compares Windows folders without case or separator differences", () => {
    assert.strictEqual(findProjectByPath(projects, "c:/users/me/games/space")?.id, "windows");
  });

  it("finds nothing for an empty path", () => {
    assert.strictEqual(findProjectByPath(projects, "  "), undefined);
  });
});

describe("inferProjectTitleFromPath", () => {
  it("names a project after its folder", () => {
    assert.strictEqual(inferProjectTitleFromPath("/Users/me/games/space/"), "space");
    assert.strictEqual(inferProjectTitleFromPath("C:\\Users\\me\\Мои игры"), "Мои игры");
    assert.strictEqual(inferProjectTitleFromPath("/"), "/");
  });
});

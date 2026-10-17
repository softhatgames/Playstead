import { assert, describe, it } from "@effect/vitest";

import { planAddProject } from "./addProject.logic.ts";

const projects = [{ id: "project:space", workspaceRoot: "/Users/me/games/space" }];

describe("planAddProject", () => {
  it("opens the project that already has the folder", () => {
    assert.deepStrictEqual(
      planAddProject({ rawPath: "/Users/me/games/space/", platform: "darwin", projects }),
      { kind: "open", projectId: "project:space" },
    );
  });

  it("creates a project named after a new folder", () => {
    assert.deepStrictEqual(
      planAddProject({ rawPath: " ~/games/new-game/ ", platform: "darwin", projects }),
      { kind: "create", workspaceRoot: "~/games/new-game", title: "new-game" },
    );
  });

  it("refuses paths the server cannot take", () => {
    assert.deepStrictEqual(planAddProject({ rawPath: "C:\\Games", platform: "darwin", projects }), {
      kind: "error",
      message: "Windows-style paths are only supported on Windows.",
    });
    assert.deepStrictEqual(planAddProject({ rawPath: "./game", platform: "darwin", projects }), {
      kind: "error",
      message: "Relative paths require an active project.",
    });
    assert.deepStrictEqual(planAddProject({ rawPath: "  ", platform: "darwin", projects }), {
      kind: "none",
    });
  });

  it("takes Windows paths on a Windows server", () => {
    assert.deepStrictEqual(
      planAddProject({ rawPath: "C:\\Games\\Космос", platform: "windows", projects }),
      { kind: "create", workspaceRoot: "C:\\Games\\Космос", title: "Космос" },
    );
  });
});

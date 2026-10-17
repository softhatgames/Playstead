import { assert, describe, it } from "@effect/vitest";

import {
  projectMenuItems,
  projectRemovalConfirmation,
  projectSettingsRemovalConfirmation,
  resolveProjectRenameCommit,
} from "./projectActions.logic.ts";

const project = { title: "Space Game", workspaceRoot: "/games/space-game" };

describe("projectMenuItems", () => {
  it("offers the project tree's project menu: rename, copy path, project settings, then remove", () => {
    assert.deepStrictEqual(
      projectMenuItems.map((item) => [item.id, item.label, item.destructive === true]),
      [
        ["rename", "Rename", false],
        ["copy-path", "Copy Path", false],
        ["project-settings", "Project settings", false],
        ["delete", "Remove", true],
      ],
    );
  });
});

describe("projectRemovalConfirmation", () => {
  it("asks about an empty project with its path", () => {
    assert.strictEqual(
      projectRemovalConfirmation({ ...project, threadCount: 0 }),
      [
        'Remove project "Space Game"?',
        "Path: /games/space-game",
        "This permanently clears any archived conversation history.",
        "This removes only this project entry.",
      ].join("\n"),
    );
  });

  it("counts the threads it deletes, and says it cannot be undone", () => {
    assert.strictEqual(
      projectRemovalConfirmation({ ...project, threadCount: 1 }),
      [
        'Remove project "Space Game" and delete its 1 thread?',
        "Path: /games/space-game",
        "This permanently clears conversation history for those threads and any archived threads.",
        "This removes only this project entry.",
        "This action cannot be undone.",
      ].join("\n"),
    );
    assert.match(
      projectRemovalConfirmation({ ...project, threadCount: 3 }),
      /^Remove project "Space Game" and delete its 3 threads\?\n/,
    );
  });
});

describe("projectSettingsRemovalConfirmation", () => {
  it("says the files on disk stay, with or without threads", () => {
    assert.strictEqual(
      projectSettingsRemovalConfirmation({ ...project, threadCount: 0 }),
      [
        'Remove project "Space Game"?',
        "Path: /games/space-game",
        "This permanently clears any archived conversation history.",
        "This removes only the project entries, not the files on disk.",
        "This action cannot be undone.",
      ].join("\n"),
    );
    assert.strictEqual(
      projectSettingsRemovalConfirmation({ ...project, threadCount: 2 }),
      [
        'Remove project "Space Game" and delete its 2 threads?',
        "Path: /games/space-game",
        "This permanently clears conversation history for those threads and any archived threads.",
        "This removes only the project entries, not the files on disk.",
        "This action cannot be undone.",
      ].join("\n"),
    );
  });
});

describe("resolveProjectRenameCommit", () => {
  it("renames to the trimmed title, keeps an unchanged one, and refuses a blank one", () => {
    assert.deepStrictEqual(resolveProjectRenameCommit("Space Game", "  Moon Jumper "), {
      kind: "rename",
      title: "Moon Jumper",
    });
    assert.deepStrictEqual(resolveProjectRenameCommit("Space Game", " Space Game"), {
      kind: "unchanged",
    });
    assert.deepStrictEqual(resolveProjectRenameCommit("Space Game", "   "), { kind: "empty" });
  });
});

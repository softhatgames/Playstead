import { assert, describe, it } from "@effect/vitest";

import { deriveThreadTitleSeed } from "./threadTitle.ts";

describe("deriveThreadTitleSeed", () => {
  it("takes the message's first 50 characters, with an ellipsis when it is longer", () => {
    assert.strictEqual(
      deriveThreadTitleSeed(
        "Use your Write tool, not the shell, to create hello-claude.txt in the current folder",
      ),
      "Use your Write tool, not the shell, to create hell...",
    );
    assert.strictEqual(deriveThreadTitleSeed("Make a platformer"), "Make a platformer");
  });

  it("joins lines and spaces, and falls back to New thread", () => {
    assert.strictEqual(deriveThreadTitleSeed("  Make\n\na   game  "), "Make a game");
    assert.strictEqual(deriveThreadTitleSeed(" \n "), "New thread");
  });
});

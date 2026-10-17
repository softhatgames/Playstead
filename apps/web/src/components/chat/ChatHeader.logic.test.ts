import { assert, describe, it } from "@effect/vitest";

import { resolveRenameCommit } from "./ChatHeader.logic.ts";

describe("resolveRenameCommit", () => {
  it("commits the new title without its surrounding spaces", () => {
    assert.deepStrictEqual(
      resolveRenameCommit({ title: "  Asteroid field ", originalTitle: "New thread" }),
      { action: "commit", title: "Asteroid field" },
    );
  });

  it("rejects an empty title", () => {
    assert.deepStrictEqual(resolveRenameCommit({ title: "   ", originalTitle: "New thread" }), {
      action: "reject-empty",
    });
  });

  it("does nothing when the title is unchanged", () => {
    assert.deepStrictEqual(
      resolveRenameCommit({ title: "New thread ", originalTitle: "New thread" }),
      { action: "noop" },
    );
  });
});

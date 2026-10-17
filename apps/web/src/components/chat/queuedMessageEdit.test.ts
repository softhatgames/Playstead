import { assert, describe, it } from "@effect/vitest";

import { recoverQueuedMessageEdit } from "./queuedMessageEdit.ts";

describe("recoverQueuedMessageEdit", () => {
  it("moves a changed edit into the composer when nothing else is typed there", () => {
    assert.deepStrictEqual(
      recoverQueuedMessageEdit({
        editText: "Fix it, then test",
        originalText: "Fix it",
        threadText: "",
      }),
      { outcome: "kept", text: "Fix it, then test" },
    );
  });

  it("discards a changed edit and restores what was typed before it began", () => {
    assert.deepStrictEqual(
      recoverQueuedMessageEdit({
        editText: "Fix it, then test",
        originalText: "Fix it",
        threadText: "Another idea",
      }),
      { outcome: "discarded", text: "Another idea" },
    );
  });

  it("ends an unchanged edit quietly", () => {
    assert.deepStrictEqual(
      recoverQueuedMessageEdit({ editText: "Fix it", originalText: "Fix it", threadText: "Draft" }),
      { outcome: "clean", text: "Draft" },
    );
  });
});

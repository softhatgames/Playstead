import { assert, describe, it } from "@effect/vitest";

import {
  confirmDialogCopy,
  readConfirmDialogState,
  registerConfirmDialogHost,
  requestConfirmDialog,
  respondToConfirmDialog,
} from "./confirmDialog.ts";

describe("requestConfirmDialog", () => {
  it("answers no when no dialog host is mounted to ask with", async () => {
    assert.isFalse(await requestConfirmDialog("Delete thread?"));
  });

  it("shows one request at a time, each with its own answer", async () => {
    const unregister = registerConfirmDialogHost();
    const first = requestConfirmDialog("Archive thread?");
    const second = requestConfirmDialog("Delete thread?", { variant: "destructive" });
    assert.deepStrictEqual(readConfirmDialogState(), {
      status: "confirming",
      message: "Archive thread?",
      variant: "default",
    });

    respondToConfirmDialog(true);
    assert.deepStrictEqual(readConfirmDialogState(), {
      status: "confirming",
      message: "Delete thread?",
      variant: "destructive",
    });
    respondToConfirmDialog(false);

    assert.isTrue(await first);
    assert.isFalse(await second);
    assert.deepStrictEqual(readConfirmDialogState(), { status: "idle" });
    unregister();
  });

  it("answers no to what is waiting when the host goes", async () => {
    const unregister = registerConfirmDialogHost();
    const waiting = requestConfirmDialog("Delete thread?");
    unregister();
    assert.isFalse(await waiting);
    assert.deepStrictEqual(readConfirmDialogState(), { status: "idle" });
  });
});

describe("confirmDialogCopy", () => {
  it("titles the dialog with the question and describes it with the rest", () => {
    assert.deepStrictEqual(
      confirmDialogCopy(
        'Delete thread "Maze"?\nThis permanently clears conversation history for this thread.',
      ),
      {
        title: 'Delete thread "Maze"?',
        description: "This permanently clears conversation history for this thread.",
      },
    );
    assert.deepStrictEqual(confirmDialogCopy('Archive thread "Maze"?'), {
      title: 'Archive thread "Maze"?',
      description: null,
    });
  });
});

import { assert, it } from "@effect/vitest";

import { readSidebarThreadRename, setSidebarThreadRename } from "./uiState.ts";

it("keeps a row's pending rename for the sidebar mounted by navigation, then clears it on finish", () => {
  setSidebarThreadRename({ threadId: "thread:maze", title: "Maze" });
  // The destination page reads the same edit; another row must not edit it.
  assert.strictEqual(readSidebarThreadRename("thread:maze"), "Maze");
  assert.isNull(readSidebarThreadRename("thread:other"));
  setSidebarThreadRename({ threadId: "thread:maze", title: "New maze" });
  assert.strictEqual(readSidebarThreadRename("thread:maze"), "New maze");
  setSidebarThreadRename(null);
  assert.isNull(readSidebarThreadRename("thread:maze"));
});

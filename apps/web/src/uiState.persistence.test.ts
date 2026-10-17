import { afterEach, assert, beforeEach, describe, it, vi } from "@effect/vitest";

/**
 * The project tree's folding kept across reloads (T3 Code's
 * `projectExpandedById` in `apps/web/src/uiStateStore.ts` at 2577baf): a
 * project is open until it is folded, and stays as it was left.
 */

const STORAGE_KEY = "playstead:ui-state:v1";

let stored: Map<string, string>;

/** The page loaded again over the same browser storage. */
const reload = async () => {
  vi.resetModules();
  return import("./uiState.ts");
};

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("project expansion", () => {
  it("shows every project open until it is folded", async () => {
    const uiState = await reload();
    assert.isTrue(uiState.resolveProjectExpanded(uiState.readProjectExpandedById(), "space"));
  });

  it("keeps a folded project folded, and an opened one open, after a reload", async () => {
    const first = await reload();
    first.setProjectExpanded("space", false);
    first.setProjectExpanded("rocket", false);
    first.setProjectExpanded("rocket", true);

    const second = await reload();
    const expanded = second.readProjectExpandedById();
    assert.isFalse(second.resolveProjectExpanded(expanded, "space"));
    assert.isTrue(second.resolveProjectExpanded(expanded, "rocket"));
    assert.isTrue(second.resolveProjectExpanded(expanded, "maze"));
  });

  it("reads state stored before projects could fold as every project open", async () => {
    stored.set(
      STORAGE_KEY,
      JSON.stringify({ sidebarProjectScopeKey: "space", sidebarOpen: true, projectOrder: ["a"] }),
    );
    const uiState = await reload();
    assert.deepStrictEqual(uiState.readProjectExpandedById(), {});
    assert.strictEqual(uiState.readSidebarProjectScopeKey(), "space");
  });
});

it("keeps the Working and Settled shelves folded until opened, independently across reloads", async () => {
  const first = await reload();
  assert.deepStrictEqual(first.readSidebarShelvesExpanded(), { working: false, settled: false });
  first.toggleSidebarShelfExpanded("working");
  const second = await reload();
  assert.deepStrictEqual(second.readSidebarShelvesExpanded(), { working: true, settled: false });
  second.toggleSidebarShelfExpanded("settled");
  second.toggleSidebarShelfExpanded("working");
  const third = await reload();
  assert.deepStrictEqual(third.readSidebarShelvesExpanded(), { working: false, settled: true });
});

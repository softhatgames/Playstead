import { assert, describe, it } from "@effect/vitest";

import {
  hasUnseenCompletion,
  isTrailingDoubleClick,
  moveSearchHighlight,
  searchSidebarThreads,
  splitSearchHighlights,
} from "./Sidebar.logic.ts";

describe("hasUnseenCompletion", () => {
  const completedAt = "2026-10-17T12:00:00.000Z";

  it("shows the dot when the latest run completed after the thread was last visited", () => {
    assert.isTrue(
      hasUnseenCompletion({
        latestRunCompletedAt: completedAt,
        lastVisitedAt: "2026-10-17T11:59:59.999Z",
      }),
    );
  });

  it("hides it once the thread was visited at or after the completion", () => {
    for (const lastVisitedAt of [completedAt, "2026-10-17T12:00:05.000Z"]) {
      assert.isFalse(hasUnseenCompletion({ latestRunCompletedAt: completedAt, lastVisitedAt }));
    }
  });

  it("hides it while the latest run has not completed, or the thread was never visited", () => {
    assert.isFalse(
      hasUnseenCompletion({
        latestRunCompletedAt: null,
        lastVisitedAt: "2026-10-17T11:00:00.000Z",
      }),
    );
    assert.isFalse(hasUnseenCompletion({ latestRunCompletedAt: completedAt, lastVisitedAt: null }));
  });
});

describe("isTrailingDoubleClick", () => {
  it("is the second click of a double-click, which must not navigate", () => {
    assert.deepStrictEqual(
      [0, 1, 2, 3].map((detail) => isTrailingDoubleClick(detail)),
      [false, false, true, true],
    );
  });
});

describe("searchSidebarThreads", () => {
  const thread = (id: string, title: string) => ({ id, title });
  // In the sidebar's order: pinned, active, working, settled.
  const threads = [
    thread("pinned", "Rocket physics"),
    thread("active", "Level select menu"),
    thread("working", "Jump sound"),
    thread("settled", "Rocket trail particles"),
  ];

  it("lists title matches in the sidebar's order, then threads that matched by message", () => {
    assert.deepStrictEqual(
      searchSidebarThreads(threads, "  ROCKET ", new Set(["working", "active"])).map((t) => t.id),
      ["pinned", "settled", "active", "working"],
    );
  });

  it("lists a thread matched by both its title and a message once, with the title matches", () => {
    assert.deepStrictEqual(
      searchSidebarThreads(threads, "rocket", new Set(["settled", "working"])).map((t) => t.id),
      ["pinned", "settled", "working"],
    );
  });

  it("finds nothing for a blank query, and ignores message matches for threads not listed", () => {
    assert.deepStrictEqual(searchSidebarThreads(threads, "   ", new Set(["active"])), []);
    assert.deepStrictEqual(searchSidebarThreads(threads, "zz", new Set(["elsewhere"])), []);
  });
});

describe("moveSearchHighlight", () => {
  it("moves down and up through the results, wrapping at either end", () => {
    assert.deepStrictEqual(
      [
        moveSearchHighlight(0, 3, "down"),
        moveSearchHighlight(2, 3, "down"),
        moveSearchHighlight(0, 3, "up"),
        moveSearchHighlight(1, 3, "up"),
      ],
      [1, 0, 2, 0],
    );
  });
});

describe("splitSearchHighlights", () => {
  it("marks every match of the query, ignoring ASCII case, as the server matched it", () => {
    assert.deepStrictEqual(splitSearchHighlights("Jump higher, JUMP again", " jump "), [
      { text: "Jump", highlighted: true, start: 0 },
      { text: " higher, ", highlighted: false, start: 4 },
      { text: "JUMP", highlighted: true, start: 13 },
      { text: " again", highlighted: false, start: 17 },
    ]);
  });

  it("leaves the text whole when the query is blank or absent", () => {
    assert.deepStrictEqual(splitSearchHighlights("…tail end", "  "), [
      { text: "…tail end", highlighted: false, start: 0 },
    ]);
    assert.deepStrictEqual(splitSearchHighlights("…tail end", "zz"), [
      { text: "…tail end", highlighted: false, start: 0 },
    ]);
  });
});

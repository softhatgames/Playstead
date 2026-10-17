import { describe, expect, it } from "vite-plus/test";
import {
  sanitizeThreadTitle,
  buildThreadTitlePrompt,
  formatThreadTitleContext,
} from "./threadTitle.ts";

describe("thread titles", () => {
  it("unwraps JSON and quotes, keeps one line, and bounds titles", () => {
    expect(sanitizeThreadTitle('{"title":" `Fix   collisions`\\nIgnore this"}')).toBe(
      "Fix collisions",
    );
    expect(sanitizeThreadTitle("  ``  ")).toBe("New thread");
    expect(sanitizeThreadTitle("x".repeat(130))).toBe("x".repeat(117) + "...");
  });
  it("bounds first-message context with both ends, and regeneration with the tail", () => {
    const message = "FIRST" + "x".repeat(9000) + "LAST";
    const initial = buildThreadTitlePrompt({ message });
    expect(initial).toContain("FIRST");
    expect(initial).toContain("LAST");
    const regenerate = buildThreadTitlePrompt({ message, previousTitle: "Old title" });
    expect(regenerate).not.toContain("FIRST");
    expect(regenerate).toContain("LAST");
    expect(regenerate).toContain("Old title");
  });
  it("retains the first user and recent conversation within 8000 characters", () => {
    const context = formatThreadTitleContext([
      { role: "user", text: "Make a platformer" },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: "assistant",
        text: `Answer ${i}: ` + "x".repeat(2100),
      })),
      { role: "reasoning", text: "PRIVATE REASONING" },
      { role: "user", text: "Now fix jumping" },
    ]);
    expect(context.length).toBeLessThanOrEqual(8000);
    expect(context).toContain("Make a platformer");
    expect(context).toContain("Now fix jumping");
    expect(context).toContain("Answer 19");
    expect(context).not.toContain("PRIVATE REASONING");
  });
});

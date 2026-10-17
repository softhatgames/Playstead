import { assert, describe, it } from "@effect/vitest";

import {
  buildCollapsedProposedPlanPreview,
  buildPlanImplementationPrompt,
  buildPlanImplementationThreadTitle,
  buildProposedPlanMarkdownFilename,
  normalizePlanMarkdownForExport,
  proposedPlanTitle,
  resolvePlanFollowUpSubmission,
} from "./proposedPlan.ts";

describe("buildPlanImplementationPrompt", () => {
  it("sends the plan after T3 Code's implementation prefix", () => {
    assert.strictEqual(
      buildPlanImplementationPrompt("## Ship it\n\n- step 1\n"),
      "PLEASE IMPLEMENT THIS PLAN:\n## Ship it\n\n- step 1",
    );
  });
});

describe("resolvePlanFollowUpSubmission", () => {
  it("implements the plan in the default mode when the composer is empty", () => {
    assert.deepStrictEqual(
      resolvePlanFollowUpSubmission({ draftText: "   ", planMarkdown: "## Ship it\n\n- step 1\n" }),
      { text: "PLEASE IMPLEMENT THIS PLAN:\n## Ship it\n\n- step 1", interactionMode: "default" },
    );
  });

  it("refines the plan, staying in plan mode, when the person wrote something", () => {
    assert.deepStrictEqual(
      resolvePlanFollowUpSubmission({ draftText: " Refine step 2 first ", planMarkdown: "# Plan" }),
      { text: "Refine step 2 first", interactionMode: "plan" },
    );
  });
});

describe("plan titles and files", () => {
  it("takes the title from the plan's first heading", () => {
    assert.strictEqual(proposedPlanTitle("Intro\n\n## Integrate RPC\n\nBody"), "Integrate RPC");
    assert.isNull(proposedPlanTitle("No heading here"));
  });

  it("names the implementation thread after the plan", () => {
    assert.strictEqual(
      buildPlanImplementationThreadTitle("# Integrate RPC\n\nBody"),
      "Implement Integrate RPC",
    );
    assert.strictEqual(buildPlanImplementationThreadTitle("Body only"), "Implement plan");
  });

  it("names the downloaded file after the plan's title", () => {
    assert.strictEqual(
      buildProposedPlanMarkdownFilename("# Create `planned-codex.txt`!\n"),
      "create-planned-codextxt.md",
    );
    assert.strictEqual(buildProposedPlanMarkdownFilename("No heading"), "plan.md");
  });

  it("exports the plan with one final newline", () => {
    assert.strictEqual(normalizePlanMarkdownForExport("# Plan\n\n- a\n\n\n"), "# Plan\n\n- a\n");
  });
});

describe("buildCollapsedProposedPlanPreview", () => {
  it("drops the title and a Summary heading, keeping the lines after them", () => {
    assert.strictEqual(
      buildCollapsedProposedPlanPreview("# Integrate RPC\n\n## Summary\n\n- step 1\n- step 2", 4),
      "- step 1\n- step 2",
    );
  });

  it("marks a preview that leaves lines out", () => {
    assert.strictEqual(
      buildCollapsedProposedPlanPreview("# Integrate RPC\n\n- step 1\n- step 2\n- step 3", 2),
      "- step 1\n- step 2\n\n...",
    );
  });
});

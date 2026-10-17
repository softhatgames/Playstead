import type { ProviderInteractionMode } from "@playstead/contracts/orchestrationV2";

/**
 * A proposed plan's text, after T3 Code's `apps/web/src/proposedPlan.ts` and
 * `packages/shared/src/proposedPlanText.ts` at 2577baf: its title, what the
 * plan card shows, the file it downloads as, and what **Implement** and
 * **Refine** send.
 */

const HEADING = /^\s{0,3}#{1,6}\s+(.+)$/;

/** The plan's first heading, which names it. */
export function proposedPlanTitle(planMarkdown: string): string | null {
  const heading = new RegExp(HEADING.source, "m").exec(planMarkdown)?.[1]?.trim();
  return heading !== undefined && heading.length > 0 ? heading : null;
}

/** The plan without its title heading, or a "Summary" heading under it, which the card shows already. */
export function stripDisplayedPlanMarkdown(planMarkdown: string): string {
  const lines = planMarkdown.trimEnd().split(/\r?\n/);
  const source = lines[0] !== undefined && HEADING.test(lines[0]) ? lines.slice(1) : [...lines];
  const dropBlank = () => {
    while (source[0]?.trim().length === 0) source.shift();
  };
  dropBlank();
  if (
    HEADING.exec(source[0] ?? "")?.[1]
      ?.trim()
      .toLowerCase() === "summary"
  ) {
    source.shift();
    dropBlank();
  }
  return source.join("\n");
}

/** The first `maxLines` lines with text, and a marker when more follow. */
export function buildCollapsedProposedPlanPreview(planMarkdown: string, maxLines = 8): string {
  const lines = stripDisplayedPlanMarkdown(planMarkdown)
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
  const preview: Array<string> = [];
  let visible = 0;
  let more = false;
  for (const line of lines) {
    const hasText = line.trim().length > 0;
    if (hasText && visible >= maxLines) {
      more = true;
      break;
    }
    preview.push(line);
    if (hasText) visible += 1;
  }
  while (preview.length > 0 && preview.at(-1)?.trim().length === 0) preview.pop();
  if (preview.length === 0) return proposedPlanTitle(planMarkdown) ?? "Plan preview unavailable.";
  if (more) preview.push("", "...");
  return preview.join("\n");
}

const PLAN_IMPLEMENTATION_PROMPT_PREFIX = "PLEASE IMPLEMENT THIS PLAN:\n";

/** What **Implement** sends. */
export function buildPlanImplementationPrompt(planMarkdown: string): string {
  return `${PLAN_IMPLEMENTATION_PROMPT_PREFIX}${planMarkdown.trim()}`;
}

/**
 * What a send does while a plan is ready: with nothing written, it
 * implements the plan in the default mode; with the person's words, it
 * refines the plan and stays in plan mode.
 */
export function resolvePlanFollowUpSubmission(input: {
  readonly draftText: string;
  readonly planMarkdown: string;
}): { readonly text: string; readonly interactionMode: ProviderInteractionMode } {
  const draft = input.draftText.trim();
  return draft.length > 0
    ? { text: draft, interactionMode: "plan" }
    : { text: buildPlanImplementationPrompt(input.planMarkdown), interactionMode: "default" };
}

/** The title of a thread made by **Implement in a new thread**. */
export function buildPlanImplementationThreadTitle(planMarkdown: string): string {
  const title = proposedPlanTitle(planMarkdown);
  return title === null ? "Implement plan" : `Implement ${title}`;
}

const planFileSegment = (input: string) => {
  const sanitized = input
    .toLowerCase()
    .replace(/[`'".,!?()[\]{}]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "plan";
};

/** The file a plan downloads or saves as, after its title. */
export function buildProposedPlanMarkdownFilename(planMarkdown: string): string {
  return `${planFileSegment(proposedPlanTitle(planMarkdown) ?? "plan")}.md`;
}

/** The plan as a file holds it: one final newline. */
export function normalizePlanMarkdownForExport(planMarkdown: string): string {
  return `${planMarkdown.trimEnd()}\n`;
}

/** Downloads the plan as a Markdown file. */
export function downloadPlanAsTextFile(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

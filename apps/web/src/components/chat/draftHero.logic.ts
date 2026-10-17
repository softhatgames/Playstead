/**
 * What a new thread's heading says (T3 Code's `DraftHeroHeadline.tsx` at
 * 2577baf): in "No project", "What should we work on?" with the project
 * picker under it; in a project, "What should we build in <picker>?" and,
 * while "No project" is offered, **or start without a project** under it.
 * With no project to choose, it asks for one to be added.
 */
export type DraftHeadline =
  | { readonly kind: "scratch"; readonly label: string }
  | {
      readonly kind: "project";
      readonly label: string;
      readonly projectName: string;
      readonly offerScratch: boolean;
    }
  | { readonly kind: "add-project"; readonly label: string };

export function resolveDraftHeadline(input: {
  readonly isScratchDraft: boolean;
  readonly projectName: string | undefined;
  readonly scratchOffered: boolean;
}): DraftHeadline {
  if (input.isScratchDraft) return { kind: "scratch", label: "What should we work on?" };
  if (input.projectName === undefined) {
    return { kind: "add-project", label: "Add a project to start" };
  }
  return {
    kind: "project",
    label: `What should we build in ${input.projectName}?`,
    projectName: input.projectName,
    offerScratch: input.scratchOffered,
  };
}

import { describe, expect, it } from "@effect/vitest";

import { resolveDraftHeadline } from "./draftHero.logic.ts";

/** A new thread's heading (T3 Code's `DraftHeroHeadline.tsx` at 2577baf). */
describe("resolveDraftHeadline", () => {
  it("asks what to build in the draft's project, offering No project while it is offered", () => {
    expect(
      resolveDraftHeadline({
        isScratchDraft: false,
        projectName: "space-game",
        scratchOffered: true,
      }),
    ).toEqual({
      kind: "project",
      label: "What should we build in space-game?",
      projectName: "space-game",
      offerScratch: true,
    });
    expect(
      resolveDraftHeadline({
        isScratchDraft: false,
        projectName: "space-game",
        scratchOffered: false,
      }),
    ).toMatchObject({ kind: "project", offerScratch: false });
  });

  it("asks what to work on in No project", () => {
    expect(
      resolveDraftHeadline({
        isScratchDraft: true,
        projectName: "No project",
        scratchOffered: true,
      }),
    ).toEqual({ kind: "scratch", label: "What should we work on?" });
  });

  it("asks for a project when the draft's project is gone", () => {
    expect(
      resolveDraftHeadline({ isScratchDraft: false, projectName: undefined, scratchOffered: true }),
    ).toEqual({ kind: "add-project", label: "Add a project to start" });
  });
});

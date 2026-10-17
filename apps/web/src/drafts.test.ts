import { expect, it } from "@effect/vitest";
import { ProjectId } from "@playstead/contracts/baseSchemas";
import { createDraft, getDraft, setDraftProject, markDraftStarted } from "./drafts.ts";

it("switches an unsent draft between projects without losing its identity, then locks its project once created", () => {
  const draftId = createDraft(ProjectId.make("game"));
  const original = getDraft(draftId)!;
  setDraftProject(draftId, ProjectId.make("scratch"));
  expect(getDraft(draftId)).toEqual({ ...original, projectId: "scratch" });
  setDraftProject(draftId, ProjectId.make("other"));
  markDraftStarted(draftId);
  setDraftProject(draftId, ProjectId.make("game"));
  expect(getDraft(draftId)?.projectId).toBe("other");
});

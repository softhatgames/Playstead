import { CommandId, type ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import { useSyncExternalStore } from "react";

import { newId } from "./ids.ts";

/**
 * New threads not yet on the server, after T3 Code's composer draft store
 * (`apps/web/src/composerDraftStore.ts` at 2577baf): **New thread** makes a
 * draft, and nothing reaches the server until its first message is sent.
 * The draft already knows the id its thread will have. Drafts live in the
 * page only.
 */
export interface ThreadDraft {
  readonly draftId: string;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  /** Kept, so a send tried again after a failure creates the thread only once. */
  readonly threadCommandId: CommandId;
  /** Chosen in the model picker; the provider's default until then. */
  readonly modelSelection: ModelSelection | undefined;
}

const drafts = new Map<string, ThreadDraft>();
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function createDraft(projectId: ProjectId): string {
  const draftId = newId();
  drafts.set(draftId, {
    draftId,
    projectId,
    threadId: ThreadId.make(`thread:${newId()}`),
    threadCommandId: CommandId.make(`command:${newId()}`),
    modelSelection: undefined,
  });
  notify();
  return draftId;
}

export function setDraftModelSelection(draftId: string, modelSelection: ModelSelection): void {
  const draft = drafts.get(draftId);
  if (draft === undefined) return;
  drafts.set(draftId, { ...draft, modelSelection });
  notify();
}

/** Once its thread exists, the draft is done. */
export function discardDraft(draftId: string): void {
  if (drafts.delete(draftId)) notify();
}

/** A removed project's drafts go with it (T3 Code's `clearProjectDraftThreadId`). */
export function discardProjectDrafts(projectId: ProjectId): void {
  let changed = false;
  for (const [draftId, draft] of drafts) {
    if (draft.projectId === projectId) changed = drafts.delete(draftId) || changed;
  }
  if (changed) notify();
}

export function useDraft(draftId: string): ThreadDraft | undefined {
  return useSyncExternalStore(subscribe, () => drafts.get(draftId));
}

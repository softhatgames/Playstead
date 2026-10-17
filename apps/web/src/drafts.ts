import { CommandId, type ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
} from "@playstead/contracts/orchestrationV2";
import type { ServerSettings } from "@playstead/contracts/settings";
import { useSyncExternalStore } from "react";

import { newId } from "./ids.ts";

/**
 * New threads not yet on the server, after T3 Code's composer draft store
 * (`apps/web/src/composerDraftStore.ts` at 2577baf): **New thread** makes a
 * draft, and nothing reaches the server until its first message is sent.
 * The draft already knows the id its thread will have. Drafts live in the
 * page only.
 *
 * A started thread's composer keeps a runtime mode and an interaction mode
 * too, once one is chosen, until the next message sends it (T3 Code's
 * `setComposerDraftRuntimeMode` and `setComposerDraftInteractionMode`).
 */
export interface ThreadDraft {
  readonly draftId: string;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  /** Kept, so a send tried again after a failure creates the thread only once. */
  readonly threadCommandId: CommandId;
  /** Chosen in the model picker; the provider's default until then. */
  readonly modelSelection: ModelSelection | undefined;
  /**
   * Chosen in the mode picker; until then the default permissions for new
   * threads when the draft was made, so a later change to the default leaves
   * it alone (T3 Code's `useHandleNewThread.ts` at 2577baf).
   */
  readonly runtimeMode: RuntimeMode;
  /** Plan or build, from the Plan/Build toggle; `default` until then. */
  readonly interactionMode: ProviderInteractionMode;
}

const drafts = new Map<string, ThreadDraft>();
const composerRuntimeModes = new Map<ThreadId, RuntimeMode>();
const composerInteractionModes = new Map<ThreadId, ProviderInteractionMode>();
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function createDraft(
  projectId: ProjectId,
  settings: Pick<ServerSettings, "defaultRuntimeMode">,
): string {
  const draftId = newId();
  drafts.set(draftId, {
    draftId,
    projectId,
    threadId: ThreadId.make(`thread:${newId()}`),
    threadCommandId: CommandId.make(`command:${newId()}`),
    modelSelection: undefined,
    runtimeMode: settings.defaultRuntimeMode,
    interactionMode: "default",
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

/**
 * Moves an unsent draft to another project, "No project" included (T3 Code's
 * `setLogicalProjectDraftThreadId` from the draft's project picker). Its
 * thread is not on the server yet, so nothing else changes.
 */
export function setDraftProject(draftId: string, projectId: ProjectId): void {
  const draft = drafts.get(draftId);
  if (draft === undefined || draft.projectId === projectId) return;
  drafts.set(draftId, { ...draft, projectId });
  notify();
}

export function setDraftRuntimeMode(draftId: string, runtimeMode: RuntimeMode): void {
  const draft = drafts.get(draftId);
  if (draft === undefined) return;
  drafts.set(draftId, { ...draft, runtimeMode });
  notify();
}

export function setDraftInteractionMode(
  draftId: string,
  interactionMode: ProviderInteractionMode,
): void {
  const draft = drafts.get(draftId);
  if (draft === undefined) return;
  drafts.set(draftId, { ...draft, interactionMode });
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

export function readDraft(draftId: string): ThreadDraft | undefined {
  return drafts.get(draftId);
}

export function useDraft(draftId: string): ThreadDraft | undefined {
  return useSyncExternalStore(subscribe, () => readDraft(draftId));
}

/** The mode chosen in a started thread's composer, for its next message. */
export function setComposerRuntimeMode(threadId: ThreadId, runtimeMode: RuntimeMode): void {
  composerRuntimeModes.set(threadId, runtimeMode);
  notify();
}

/** Once the next message has sent it, the thread's own mode is the composer's. */
export function clearComposerRuntimeMode(threadId: ThreadId): void {
  if (composerRuntimeModes.delete(threadId)) notify();
}

export function useComposerRuntimeMode(threadId: ThreadId): RuntimeMode | undefined {
  return useSyncExternalStore(subscribe, () => composerRuntimeModes.get(threadId));
}

/** Plan or build, chosen in a started thread's composer, for its next message. */
export function setComposerInteractionMode(
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode,
): void {
  composerInteractionModes.set(threadId, interactionMode);
  notify();
}

/** Once the next message has sent it, the thread's own interaction mode is the composer's. */
export function clearComposerInteractionMode(threadId: ThreadId): void {
  if (composerInteractionModes.delete(threadId)) notify();
}

export function useComposerInteractionMode(
  threadId: ThreadId,
): ProviderInteractionMode | undefined {
  return useSyncExternalStore(subscribe, () => composerInteractionModes.get(threadId));
}

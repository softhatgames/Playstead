import { CommandId, type ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import {
  DEFAULT_RUNTIME_MODE,
  type ModelSelection,
  type RuntimeMode,
} from "@playstead/contracts/orchestrationV2";
import { useSyncExternalStore } from "react";

import { newId } from "./ids.ts";

/**
 * New threads not yet on the server, after T3 Code's composer draft store
 * (`apps/web/src/composerDraftStore.ts` at 2577baf): **New thread** makes a
 * draft, and nothing reaches the server until its first message is sent.
 * The draft already knows the id its thread will have. Drafts live in the
 * page only.
 *
 * A started thread's composer keeps a runtime mode too, once one is chosen
 * in its picker, until the next message sends it (T3 Code's
 * `setComposerDraftRuntimeMode`).
 */
export interface ThreadDraft {
  readonly draftId: string;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  /** Kept, so a send tried again after a failure creates the thread only once. */
  readonly threadCommandId: CommandId;
  /** Chosen in the model picker; the provider's default until then. */
  readonly modelSelection: ModelSelection | undefined;
  /** Chosen in the mode picker; Full access until then. */
  readonly runtimeMode: RuntimeMode;
}

const drafts = new Map<string, ThreadDraft>();
const composerRuntimeModes = new Map<ThreadId, RuntimeMode>();
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
    runtimeMode: DEFAULT_RUNTIME_MODE,
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

export function setDraftRuntimeMode(draftId: string, runtimeMode: RuntimeMode): void {
  const draft = drafts.get(draftId);
  if (draft === undefined) return;
  drafts.set(draftId, { ...draft, runtimeMode });
  notify();
}

/** Once its thread exists, the draft is done. */
export function discardDraft(draftId: string): void {
  if (drafts.delete(draftId)) notify();
}

export function useDraft(draftId: string): ThreadDraft | undefined {
  return useSyncExternalStore(subscribe, () => drafts.get(draftId));
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

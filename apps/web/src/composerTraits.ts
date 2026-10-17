import type { ProviderOptionSelection } from "@playstead/contracts/model";
import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import { useSyncExternalStore } from "react";

import { makeTraitsMemory } from "./components/chat/traits.logic.ts";

/**
 * The traits each composer has chosen and not yet sent, after T3 Code's
 * composer draft store (`setProviderModelOptions` in
 * `apps/web/src/composerDraftStore.ts` at 2577baf): keyed by draft or
 * thread, for the model they were chosen on, in the page only. Each choice
 * is also remembered per provider instance and model for new threads, in
 * `localStorage`, as T3 Code's sticky options are.
 */

const memory = makeTraitsMemory(
  typeof localStorage === "undefined"
    ? { getItem: () => null, setItem: () => undefined }
    : localStorage,
);

/** The options remembered for a model, if any. */
export const recallTraits = memory.recall;

const chosen = new Map<string, ModelSelection>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notify = () => {
  for (const listener of listeners) listener();
};

/** A composer's new traits for its model, remembered for that model too. */
export function setComposerTraits(
  key: string,
  selection: Pick<ModelSelection, "instanceId" | "model">,
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
): void {
  chosen.set(key, {
    instanceId: selection.instanceId,
    model: selection.model,
    ...(options === undefined ? {} : { options }),
  });
  memory.remember(selection.instanceId, selection.model, options);
  notify();
}

/** Once sent, or once the model changes, the composer's choice is the thread's. */
export function clearComposerTraits(key: string): void {
  if (chosen.delete(key)) notify();
}

export function useComposerTraits(key: string): ModelSelection | undefined {
  return useSyncExternalStore(subscribe, () => chosen.get(key));
}

import type { ThreadLifecycleTarget } from "./hooks/useThreadActions.ts";

type Handler = (thread: ThreadLifecycleTarget, until: string) => boolean;
let registered: Handler | null = null;
/** Route header snoozes through the mounted inbox's shared parking navigation. */
export function registerSnoozeAndAdvance(handler: Handler): () => void {
  registered = handler;
  return () => {
    if (registered === handler) registered = null;
  };
}
export function snoozeAndAdvance(thread: ThreadLifecycleTarget, until: string): boolean {
  return registered?.(thread, until) ?? false;
}

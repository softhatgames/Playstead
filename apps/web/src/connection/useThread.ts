import type { ThreadState } from "@playstead/client-runtime/state/thread";
import type { ThreadId } from "@playstead/contracts/baseSchemas";
import { useEffect, useState } from "react";

import { followPrimaryThread, usePrimaryConnectionState } from "./runtime.ts";

interface Followed {
  readonly threadId: ThreadId;
  readonly state: ThreadState | undefined;
  readonly error: string | undefined;
}

/**
 * One thread, live: its projection from the thread stream, folded as events
 * arrive (T3 Code's `useThreadProjection`, `apps/web/src/state/entities.ts`
 * at 2577baf). While the server is away the thread keeps showing what it
 * last had, as T3 Code's cached projections do; once it is back a fresh
 * snapshot replaces it. A thread not on the server yet, a draft, has
 * nothing to follow.
 */
export function useThreadState(
  threadId: ThreadId,
  enabled: boolean,
): {
  readonly state: ThreadState | undefined;
  readonly error: string | undefined;
} {
  const started = usePrimaryConnectionState() !== undefined;
  const [followed, setFollowed] = useState<Followed | undefined>(undefined);

  useEffect(() => {
    if (!started || !enabled) return;
    return followPrimaryThread(
      threadId,
      (state) => setFollowed({ threadId, state, error: undefined }),
      (error) =>
        setFollowed((current) => ({
          threadId,
          state: current?.threadId === threadId ? current.state : undefined,
          error: error.message,
        })),
    );
  }, [threadId, started, enabled]);

  // Another thread's state never shows, even for the render before its own arrives.
  const current = enabled && followed?.threadId === threadId ? followed : undefined;
  return { state: current?.state, error: current?.error };
}

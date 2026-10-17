import { applyThreadStreamItem, type ThreadState } from "@playstead/client-runtime/state/thread";
import type { ThreadId } from "@playstead/contracts/baseSchemas";
import { useEffect, useState } from "react";

import { runPrimaryStream, usePrimaryConnectionState } from "./runtime.ts";

/**
 * One thread, live: its projection from the thread stream, folded as events
 * arrive (T3 Code's `useThreadProjection`, `apps/web/src/state/entities.ts`
 * at 2577baf). The stream opens again with a fresh snapshot whenever the
 * connection comes back. A thread not on the server yet, a draft, has
 * nothing to follow.
 */
export function useThreadState(
  threadId: ThreadId,
  enabled: boolean,
): {
  readonly state: ThreadState | undefined;
  readonly error: string | undefined;
} {
  const connected = usePrimaryConnectionState()?.phase === "connected";
  const [state, setState] = useState<ThreadState | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setState(undefined);
    setError(undefined);
    if (!connected || !enabled) return;
    return runPrimaryStream(
      (client) => client["orchestration.subscribeThread"]({ threadId }),
      (item) => setState((current) => applyThreadStreamItem(current, item)),
      (ended) => {
        if (ended?._tag === "OrchestrationThreadNotFoundError") setError(ended.message);
      },
    );
  }, [threadId, connected, enabled]);

  return { state, error };
}

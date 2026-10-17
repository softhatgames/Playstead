import { applyArchivedShellStreamItem } from "@playstead/client-runtime/state/archivedThreads";
import type { OrchestrationV2ArchivedShellSnapshot } from "@playstead/contracts/orchestrationV2";
import { useEffect, useState } from "react";

import { runPrimaryStream, usePrimaryConnectionState } from "./runtime.ts";

/**
 * **Settings → Archive**'s threads, live (T3 Code's `useArchivedThreadSnapshots`
 * over `subscribeArchivedShell` at 2577baf). The stream opens again with a
 * fresh snapshot whenever the connection comes back; until the first
 * snapshot arrives there is nothing.
 */
export function useArchivedThreads(): OrchestrationV2ArchivedShellSnapshot | undefined {
  const connected = usePrimaryConnectionState()?.phase === "connected";
  const [archive, setArchive] = useState<OrchestrationV2ArchivedShellSnapshot | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!connected) return;
    return runPrimaryStream(
      (client) => client["orchestration.subscribeArchivedShell"]({}),
      (item) => setArchive((current) => applyArchivedShellStreamItem(current, item)),
      () => {},
    );
  }, [connected]);

  return archive;
}

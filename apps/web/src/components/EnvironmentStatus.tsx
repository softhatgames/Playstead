import type { ConnectionState } from "@playstead/client-runtime/connection";

import { usePrimaryConnectionState } from "../connection/runtime.ts";

const describeConnection = (state: ConnectionState | undefined): string => {
  if (state === undefined || state.phase === "connecting") return "Connecting to the server…";
  if (state.phase === "reconnecting") return "Connection lost. Reconnecting…";
  return "Connected";
};

const describeEnvironment = (state: ConnectionState | undefined): string => {
  switch (state?.lifecycle?.type) {
    case "ready":
      return "Ready";
    case "welcome":
      return "Starting";
    default:
      return "Waiting for the server";
  }
};

/** The server and environment status, as the connection reports them. */
export function EnvironmentStatus() {
  const state = usePrimaryConnectionState();
  const environment = state?.config?.environment;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
      <dt className="text-neutral-500 dark:text-neutral-400">Server</dt>
      <dd>{describeConnection(state)}</dd>
      <dt className="text-neutral-500 dark:text-neutral-400">Environment</dt>
      <dd>{describeEnvironment(state)}</dd>
      {environment ? (
        <>
          <dt className="text-neutral-500 dark:text-neutral-400">Computer</dt>
          <dd>{environment.label}</dd>
          <dt className="text-neutral-500 dark:text-neutral-400">Platform</dt>
          <dd>
            {environment.platform.os} {environment.platform.arch}
          </dd>
          <dt className="text-neutral-500 dark:text-neutral-400">Server version</dt>
          <dd>{environment.serverVersion}</dd>
        </>
      ) : null}
      {state?.lastError ? (
        <>
          <dt className="text-neutral-500 dark:text-neutral-400">Last error</dt>
          <dd>{state.lastError}</dd>
        </>
      ) : null}
    </dl>
  );
}

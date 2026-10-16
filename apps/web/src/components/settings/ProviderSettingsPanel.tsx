import {
  PROVIDER_INSTANCE_IDS,
  type ProviderInstanceId,
} from "@playstead/contracts/providerInstance";
import { useState } from "react";

import { requestPrimary, usePrimaryConnectionState } from "../../connection/runtime.ts";
import { ProviderInstanceCard } from "./ProviderInstanceCard.tsx";

const DISPLAY_NAMES: Record<ProviderInstanceId, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
};

/**
 * **Settings → Providers**: a card for each built-in instance, after T3 Code's
 * `ProviderSettingsPanel.tsx` at 2577baf. Statuses and settings arrive on the
 * connection's config stream; refresh and **Binary path** are RPC calls.
 */
export function ProviderSettingsPanel() {
  const state = usePrimaryConnectionState();
  const config = state?.config;
  const [refreshing, setRefreshing] = useState<ReadonlySet<ProviderInstanceId | "all">>(new Set());

  const refresh = (target: ProviderInstanceId | "all") => {
    setRefreshing((current) => new Set(current).add(target));
    void requestPrimary((client) =>
      client["server.refreshProviders"](target === "all" ? {} : { instanceId: target }),
    )
      .catch(() => undefined)
      .finally(() =>
        setRefreshing((current) => {
          const next = new Set(current);
          next.delete(target);
          return next;
        }),
      );
  };

  const saveBinaryPath = (instanceId: ProviderInstanceId, binaryPath: string) =>
    requestPrimary((client) =>
      client["server.updateSettings"]({
        providerInstanceMutation: {
          operation: "upsert",
          instanceId,
          instance: { driver: instanceId, config: { binaryPath } },
        },
      }),
    ).then(() => undefined);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Providers</h1>
        <button
          type="button"
          onClick={() => refresh("all")}
          disabled={config === undefined || refreshing.has("all")}
          className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Refresh provider status
        </button>
      </div>
      {state?.phase !== "connected" ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Connecting to the server…</p>
      ) : null}
      {PROVIDER_INSTANCE_IDS.map((instanceId) => (
        <ProviderInstanceCard
          key={instanceId}
          instanceId={instanceId}
          displayName={DISPLAY_NAMES[instanceId]}
          provider={config?.providers.find((provider) => provider.instanceId === instanceId)}
          binaryPath={config?.settings.providerInstances[instanceId]?.config?.binaryPath ?? ""}
          refreshing={refreshing.has(instanceId) || refreshing.has("all")}
          onRefresh={() => refresh(instanceId)}
          onSaveBinaryPath={(binaryPath) => saveBinaryPath(instanceId, binaryPath)}
        />
      ))}
    </div>
  );
}

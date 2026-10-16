import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import type { ServerProvider } from "@playstead/contracts/server";
import { DEFAULT_BINARY_PATHS } from "@playstead/contracts/settings";
import { useEffect, useId, useState } from "react";

import {
  PROVIDER_STATUS_DOT,
  getCompatibilityWarning,
  getProviderSummary,
  getProviderVersionLabel,
} from "./providerStatus.ts";

export interface ProviderInstanceCardProps {
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string;
  readonly provider: ServerProvider | undefined;
  /** The saved **Binary path**, or `""` for the default command. */
  readonly binaryPath: string;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly onSaveBinaryPath: (binaryPath: string) => Promise<void>;
}

/**
 * One provider instance, after T3 Code's `ProviderInstanceCard.tsx` at
 * 2577baf: the status dot, the summary (which says whether the provider is
 * signed in), the version, the compatibility warning, **Binary path** and a
 * refresh.
 */
export function ProviderInstanceCard(props: ProviderInstanceCardProps) {
  const { provider } = props;
  const summary = getProviderSummary(provider);
  const version = getProviderVersionLabel(provider?.version);
  const warning = provider ? getCompatibilityWarning(provider) : null;
  const fieldId = useId();
  const [draft, setDraft] = useState(props.binaryPath);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => setDraft(props.binaryPath), [props.binaryPath]);

  const save = () => {
    if (draft.trim() === props.binaryPath) return;
    setSaveError(null);
    props.onSaveBinaryPath(draft).catch((error: unknown) => {
      setSaveError(error instanceof Error ? error.message : String(error));
    });
  };

  return (
    <section
      aria-label={props.displayName}
      className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-base font-medium">
            <span
              aria-hidden
              className={`size-2 rounded-full ${provider ? PROVIDER_STATUS_DOT[provider.status] : "bg-neutral-400"}`}
            />
            {props.displayName}
            {version ? (
              <span className="text-sm font-normal text-neutral-500 dark:text-neutral-400">
                {version}
              </span>
            ) : null}
          </h2>
          <p className="text-sm">{summary.headline}</p>
          {summary.detail ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{summary.detail}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.refreshing}
          className="shrink-0 rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {props.refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {warning ? (
        <div
          role="status"
          className={`rounded-md px-3 py-2 text-sm ${
            warning.emphasis === "strong"
              ? "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100"
              : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          }`}
        >
          <p className="font-medium">{warning.title}</p>
          <p>{warning.detail}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-sm font-medium">
          Binary path
        </label>
        <input
          id={fieldId}
          type="text"
          spellCheck={false}
          value={draft}
          placeholder={DEFAULT_BINARY_PATHS[props.instanceId]}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
          className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 font-mono text-sm dark:border-neutral-700"
        />
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Path to the {props.displayName} binary used by this instance. Empty runs{" "}
          <code>{DEFAULT_BINARY_PATHS[props.instanceId]}</code> from PATH.
        </p>
        {saveError ? <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p> : null}
      </div>
    </section>
  );
}

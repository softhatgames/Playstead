import { type ClientSettings, DEFAULT_CLIENT_SETTINGS } from "@playstead/contracts/ipc";
import type { ReactNode } from "react";

import { updateClientSettings, useClientSettings } from "../../clientSettings.ts";
import { failureToast } from "../../toast.ts";

/**
 * **Settings → General**, with only the rows Playstead has so far (T3 Code's
 * `GeneralSettingsPanel` in `apps/web/src/components/settings/SettingsPanels.tsx`
 * at 2577baf): the **Confirmations** section's archive and delete rows. The
 * slice's other rows (text generation, automatic settlement, the sidebar)
 * join it with their features; the rest of General waits for slice 5.
 */
export function GeneralSettingsPanel() {
  const settings = useClientSettings();
  const save = (patch: Partial<ClientSettings>) =>
    updateClientSettings(patch).catch((error: unknown) =>
      failureToast("Failed to save settings", error),
    );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">General</h1>
      <section aria-labelledby="settings-confirmations" className="flex flex-col gap-2">
        <h2
          id="settings-confirmations"
          className="text-sm font-medium text-neutral-600 dark:text-neutral-300"
        >
          Confirmations
        </h2>
        <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          <SettingsSwitchRow
            title="Archive confirmation"
            description="Ask before archiving a thread."
            ariaLabel="Confirm thread archiving"
            checked={settings.confirmThreadArchive}
            isDefault={
              settings.confirmThreadArchive === DEFAULT_CLIENT_SETTINGS.confirmThreadArchive
            }
            onChange={(confirmThreadArchive) => save({ confirmThreadArchive })}
          />
          <SettingsSwitchRow
            title="Delete confirmation"
            description="Ask before deleting a thread and its chat history."
            ariaLabel="Confirm thread deletion"
            checked={settings.confirmThreadDelete}
            isDefault={settings.confirmThreadDelete === DEFAULT_CLIENT_SETTINGS.confirmThreadDelete}
            onChange={(confirmThreadDelete) => save({ confirmThreadDelete })}
          />
        </div>
      </section>
    </div>
  );
}

/** A row with a switch, and **Reset** while it is off its default (T3 Code's `SettingsRow`). */
function SettingsSwitchRow(props: {
  readonly title: string;
  readonly description: ReactNode;
  readonly ariaLabel: string;
  readonly checked: boolean;
  readonly isDefault: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{props.title}</div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">{props.description}</div>
      </div>
      {props.isDefault ? null : (
        <button
          type="button"
          onClick={() => props.onChange(!props.checked)}
          className="text-xs text-neutral-500 hover:underline dark:text-neutral-400"
        >
          Reset
        </button>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.ariaLabel}
        onClick={() => props.onChange(!props.checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          props.checked ? "bg-sky-600" : "bg-neutral-300 dark:bg-neutral-700"
        }`}
      >
        <span
          className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${
            props.checked ? "translate-x-4.5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

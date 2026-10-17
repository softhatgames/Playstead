import { type ClientSettings, DEFAULT_CLIENT_SETTINGS } from "@playstead/contracts/ipc";
import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import { DEFAULT_SERVER_SETTINGS } from "@playstead/contracts/settings";
import type { ReactNode } from "react";

import { updateClientSettings, useClientSettings } from "../../clientSettings.ts";
import { requestPrimary, usePrimaryConnectionState } from "../../connection/runtime.ts";
import { failureToast } from "../../toast.ts";
import { deriveModelPickerEntries } from "../chat/composer.logic.ts";
import { ProviderModelPicker } from "../chat/ProviderModelPicker.tsx";
import { ChevronRightIcon } from "../icons.tsx";
import { resolveTextGenerationSelection } from "./textGenerationSettings.logic.ts";

/**
 * **Settings → General**, with only the rows Playstead has so far (T3 Code's
 * `GeneralSettingsPanel` in `apps/web/src/components/settings/SettingsPanels.tsx`
 * at 2577baf): **Organization**'s Working section (beta), the
 * **Confirmations** section's archive and delete rows, **Text generation**
 * (the provider and model that write thread titles), and **Sidebar
 * (legacy)** under the folded **Legacy features**. Automatic settlement
 * joins it with #39; the rest of General waits for slice 5.
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
      <section aria-labelledby="settings-organization" className="flex flex-col gap-2">
        <h2
          id="settings-organization"
          className="text-sm font-medium text-neutral-600 dark:text-neutral-300"
        >
          Organization
        </h2>
        <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          <SettingsSwitchRow
            title="Working section (beta)"
            description="Fold working and monitoring threads into a Working section. They return to the top of the inbox when they need you."
            ariaLabel="Working section (beta)"
            checked={settings.sidebarWorkingShelfEnabled}
            isDefault={
              settings.sidebarWorkingShelfEnabled ===
              DEFAULT_CLIENT_SETTINGS.sidebarWorkingShelfEnabled
            }
            onChange={(sidebarWorkingShelfEnabled) => save({ sidebarWorkingShelfEnabled })}
          />
        </div>
      </section>
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
      <TextGenerationSection />
      <details className="group flex flex-col gap-2">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100">
          <h2 className="font-normal">Legacy features</h2>
          <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        </summary>
        <div className="mt-2 divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          <SettingsSwitchRow
            title="Sidebar (legacy)"
            description="Restore per-project thread trees instead of the default flat sidebar."
            ariaLabel="Sidebar (legacy)"
            checked={settings.legacySidebarEnabled}
            isDefault={
              settings.legacySidebarEnabled === DEFAULT_CLIENT_SETTINGS.legacySidebarEnabled
            }
            onChange={(legacySidebarEnabled) => save({ legacySidebarEnabled })}
          />
        </div>
      </details>
    </div>
  );
}

const sameSelection = (left: ModelSelection, right: ModelSelection) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * **Text generation** (T3 Code's section of that name in
 * `SettingsPanels.tsx`): the model picker over the installed providers,
 * standing on the fallback when the chosen provider cannot run, and
 * **Reset** while the setting is off T3 Code's default. A server setting,
 * saved through `server.updateSettings`. Choosing reasoning effort and the
 * other options waits for the traits picker (slice 1).
 */
function TextGenerationSection() {
  const config = usePrimaryConnectionState()?.config;
  const save = (textGenerationModelSelection: ModelSelection) =>
    requestPrimary((client) =>
      client["server.updateSettings"]({ patch: { textGenerationModelSelection } }),
    ).catch((error: unknown) => failureToast("Text generation model not saved", error));
  const entries = config === undefined ? [] : deriveModelPickerEntries(config.providers, undefined);
  const saved = config?.settings.textGenerationModelSelection;
  const selection =
    config === undefined || saved === undefined
      ? undefined
      : resolveTextGenerationSelection(saved, config.providers);
  const isDefault =
    saved === undefined ||
    sameSelection(saved, DEFAULT_SERVER_SETTINGS.textGenerationModelSelection);

  return (
    <section aria-labelledby="settings-text-generation" className="flex flex-col gap-2">
      <h2
        id="settings-text-generation"
        className="text-sm font-medium text-neutral-600 dark:text-neutral-300"
      >
        Text generation
      </h2>
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-4 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Text generation model</div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Used for thread titles.
            </div>
          </div>
          {isDefault ? null : (
            <button
              type="button"
              aria-label="Reset text generation model to default"
              onClick={() => void save(DEFAULT_SERVER_SETTINGS.textGenerationModelSelection)}
              className="text-xs text-neutral-500 hover:underline dark:text-neutral-400"
            >
              Reset
            </button>
          )}
          {config === undefined ? (
            <span className="text-sm text-neutral-500 dark:text-neutral-400">
              Connecting to the server…
            </span>
          ) : entries.length === 0 ? (
            <span className="text-sm text-neutral-500 dark:text-neutral-400">
              No text generation providers available.
            </span>
          ) : (
            <ProviderModelPicker
              entries={entries}
              selection={selection}
              disabled={false}
              placement="below"
              ariaLabel="Text generation model"
              onSelect={(next) => void save(resolveTextGenerationSelection(next, config.providers))}
            />
          )}
        </div>
      </div>
    </section>
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

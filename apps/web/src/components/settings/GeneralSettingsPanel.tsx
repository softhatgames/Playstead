import { ACTIVE_TURN_COMPOSER_ACTIONS } from "@playstead/client-runtime/state/composerDispatch";
import {
  type ClientSettings,
  DEFAULT_CLIENT_SETTINGS,
  type FollowUpBehavior,
} from "@playstead/contracts/ipc";
import { DEFAULT_SERVER_SETTINGS, type ServerSettingsPatch } from "@playstead/contracts/settings";
import { type ReactNode, useState } from "react";

import { updateClientSettings, useClientSettings } from "../../clientSettings.ts";
import { requestPrimary, usePrimaryConnectionState } from "../../connection/runtime.ts";
import { ChevronRightIcon } from "../icons.tsx";
import { RuntimeModePicker } from "../chat/RuntimeModePicker.tsx";

/**
 * **Settings → General**, with only the rows Playstead has so far (T3 Code's
 * `GeneralSettingsPanel` in `apps/web/src/components/settings/SettingsPanels.tsx`
 * at 2577baf): the **New threads** section's **Permissions** row (T3 Code's
 * `ProjectDefaultsSettings.tsx`), and the **Behavior** section's
 * **Follow-up behavior** row, a client setting. Projects can't override the
 * permissions yet, so that description leaves out T3 Code's "Projects can
 * override them."; the follow-up row offers **Queue** and **Steer** with
 * T3 Code's description for its default send shortcut (Playstead has no
 * other). **Legacy features** holds **Plan mode (legacy)**, off by default,
 * as in T3 Code. The rest of General waits for its features and slice 5.
 */
export function GeneralSettingsPanel() {
  const state = usePrimaryConnectionState();
  const settings = state?.config?.settings;
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const clientSettings = useClientSettings();
  const [legacyOpen, setLegacyOpen] = useState(false);
  const saveClient = (patch: Partial<ClientSettings>) => {
    setSaveFailed(false);
    void updateClientSettings(patch).catch(() => setSaveFailed(true));
  };

  const save = (patch: ServerSettingsPatch) => {
    setSaveFailed(false);
    void requestPrimary((client) => client["server.updateSettings"]({ patch })).catch(() =>
      setSaveFailed(true),
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">General</h1>
      {settings === undefined ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Connecting to the server…</p>
      ) : (
        <section aria-labelledby="settings-new-threads" className="flex flex-col gap-2">
          <h2
            id="settings-new-threads"
            className="text-sm font-medium text-neutral-600 dark:text-neutral-300"
          >
            New threads
          </h2>
          <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            <SettingsRow
              title="Permissions"
              description="Default permissions for new threads."
              reset={{
                label: "default permissions",
                isDefault:
                  settings.defaultRuntimeMode === DEFAULT_SERVER_SETTINGS.defaultRuntimeMode,
                onReset: () =>
                  save({ defaultRuntimeMode: DEFAULT_SERVER_SETTINGS.defaultRuntimeMode }),
              }}
              control={
                <RuntimeModePicker
                  variant="setting"
                  mode={settings.defaultRuntimeMode}
                  open={permissionsOpen}
                  onOpenChange={setPermissionsOpen}
                  onSelect={(defaultRuntimeMode) => save({ defaultRuntimeMode })}
                />
              }
            />
          </div>
        </section>
      )}
      <section aria-labelledby="settings-behavior" className="flex flex-col gap-2">
        <h2
          id="settings-behavior"
          className="text-sm font-medium text-neutral-600 dark:text-neutral-300"
        >
          Behavior
        </h2>
        <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          <SettingsRow
            title="Follow-up behavior"
            description={`Queue follow-ups while the agent runs or steer the current run. Press ${
              /mac/i.test(navigator.platform) ? "⌘" : "Ctrl"
            } + Enter to do the opposite for one message.`}
            reset={{
              label: "follow-up behavior",
              isDefault:
                clientSettings.followUpBehavior === DEFAULT_CLIENT_SETTINGS.followUpBehavior,
              onReset: () =>
                saveClient({ followUpBehavior: DEFAULT_CLIENT_SETTINGS.followUpBehavior }),
            }}
            control={
              <select
                aria-label="Follow-up behavior"
                value={clientSettings.followUpBehavior}
                onChange={(event) => {
                  const value = ACTIVE_TURN_COMPOSER_ACTIONS.find(
                    (action) => action === event.target.value,
                  );
                  if (value !== undefined) saveClient({ followUpBehavior: value });
                }}
                className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                {ACTIVE_TURN_COMPOSER_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {FOLLOW_UP_LABELS[action]}
                  </option>
                ))}
              </select>
            }
          />
        </div>
      </section>
      <section aria-labelledby="settings-legacy" className="flex flex-col gap-2">
        <h2 id="settings-legacy">
          <button
            type="button"
            aria-expanded={legacyOpen}
            onClick={() => setLegacyOpen((open) => !open)}
            className="flex items-center gap-1 text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
          >
            Legacy features
            <ChevronRightIcon
              className={`size-4 transition-transform ${legacyOpen ? "rotate-90" : ""}`}
            />
          </button>
        </h2>
        {legacyOpen ? (
          <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            <SettingsRow
              title="Plan mode (legacy)"
              description="Restore Build/Plan, /plan, /default, and Shift+Tab. Off uses build mode."
              control={
                <Switch
                  label="Plan mode (legacy)"
                  checked={clientSettings.planModeEnabled}
                  onChange={(planModeEnabled) => saveClient({ planModeEnabled })}
                />
              }
            />
          </div>
        ) : null}
      </section>
      {saveFailed ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to save settings.
        </p>
      ) : null}
    </div>
  );
}

const FOLLOW_UP_LABELS: Record<FollowUpBehavior, string> = { queue: "Queue", steer: "Steer" };

/**
 * A setting's row: its title, description and control, and **Reset** while
 * it is off its default (T3 Code's `SettingsRow` and `SettingResetButton`).
 */
function SettingsRow(props: {
  readonly title: string;
  readonly description: ReactNode;
  readonly reset?: {
    readonly label: string;
    readonly isDefault: boolean;
    readonly onReset: () => void;
  };
  readonly control: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{props.title}</div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">{props.description}</div>
      </div>
      {props.reset === undefined || props.reset.isDefault ? null : (
        <button
          type="button"
          aria-label={`Reset ${props.reset.label} to default`}
          title="Reset to default"
          onClick={props.reset.onReset}
          className="text-xs text-neutral-500 hover:underline dark:text-neutral-400"
        >
          Reset
        </button>
      )}
      {props.control}
    </div>
  );
}

/** An on/off setting (T3 Code's `Switch`). */
function Switch(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
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
  );
}

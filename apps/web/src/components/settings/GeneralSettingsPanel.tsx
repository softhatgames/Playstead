import { DEFAULT_SERVER_SETTINGS, type ServerSettingsPatch } from "@playstead/contracts/settings";
import { type ReactNode, useState } from "react";

import { requestPrimary, usePrimaryConnectionState } from "../../connection/runtime.ts";
import { RuntimeModePicker } from "../chat/RuntimeModePicker.tsx";

/**
 * **Settings → General**, with only the rows Playstead has so far (T3 Code's
 * `GeneralSettingsPanel` in `apps/web/src/components/settings/SettingsPanels.tsx`
 * at 2577baf): the **New threads** section's **Permissions** row (T3 Code's
 * `ProjectDefaultsSettings.tsx`). Projects can't override it yet, so its
 * description leaves out T3 Code's "Projects can override them." The rest of
 * General waits for its features and slice 5.
 */
export function GeneralSettingsPanel() {
  const state = usePrimaryConnectionState();
  const settings = state?.config?.settings;
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

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
              resetLabel="default permissions"
              isDefault={settings.defaultRuntimeMode === DEFAULT_SERVER_SETTINGS.defaultRuntimeMode}
              onReset={() =>
                save({ defaultRuntimeMode: DEFAULT_SERVER_SETTINGS.defaultRuntimeMode })
              }
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
      {saveFailed ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to save settings.
        </p>
      ) : null}
    </div>
  );
}

/**
 * A setting's row: its title, description and control, and **Reset** while
 * it is off its default (T3 Code's `SettingsRow` and `SettingResetButton`).
 */
function SettingsRow(props: {
  readonly title: string;
  readonly description: ReactNode;
  readonly resetLabel: string;
  readonly isDefault: boolean;
  readonly onReset: () => void;
  readonly control: ReactNode;
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
          aria-label={`Reset ${props.resetLabel} to default`}
          title="Reset to default"
          onClick={props.onReset}
          className="text-xs text-neutral-500 hover:underline dark:text-neutral-400"
        >
          Reset
        </button>
      )}
      {props.control}
    </div>
  );
}

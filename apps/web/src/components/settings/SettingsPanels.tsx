import { groupArchivedThreadsByProject } from "@playstead/client-runtime/state/archivedThreads";
import { ACTIVE_TURN_COMPOSER_ACTIONS } from "@playstead/client-runtime/state/composerDispatch";
import {
  type ClientSettings,
  DEFAULT_CLIENT_SETTINGS,
  type FollowUpBehavior,
} from "@playstead/contracts/ipc";
import type {
  ModelSelection,
  OrchestrationV2ThreadShell,
} from "@playstead/contracts/orchestrationV2";
import {
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  type ServerSettingsPatch,
} from "@playstead/contracts/settings";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { updateClientSettings, useClientSettings } from "../../clientSettings.ts";
import { requestPrimary, usePrimaryConnectionState } from "../../connection/runtime.ts";
import { useArchivedThreads } from "../../connection/useArchivedThreads.ts";
import { useThreadActions } from "../../hooks/useThreadActions.ts";
import { readLocalApi } from "../../localApi.ts";
import { archivedThreadMenuItems } from "../threadActionMenu.logic.ts";
import { failureToast } from "../ui/toast.tsx";
import { deriveModelPickerEntries } from "../chat/composer.logic.ts";
import { ProviderModelPicker } from "../chat/ProviderModelPicker.tsx";
import { RuntimeModePicker } from "../chat/RuntimeModePicker.tsx";
import { ChevronRightIcon } from "../icons.tsx";
import { parseAutoSettleDays } from "./autoSettleSettings.logic.ts";
import { resolveTextGenerationSelection } from "./textGenerationSettings.logic.ts";

/** Saves part of the server's settings through `server.updateSettings`. */
const saveServerSettings = (patch: ServerSettingsPatch, failureTitle = "Failed to save settings") =>
  requestPrimary((client) => client["server.updateSettings"]({ patch })).catch((error: unknown) =>
    failureToast(failureTitle, error),
  );

/**
 * **Settings → General**, with only the rows Playstead has so far, in T3
 * Code's order (`GeneralSettingsPanel` in
 * `apps/web/src/components/settings/SettingsPanels.tsx` at 2577baf):
 *
 * - **New threads**: **Permissions** (T3 Code's `ProjectDefaultsSettings.tsx`;
 *   projects can't override them yet, so the description leaves out "Projects
 *   can override them.");
 * - **Organization**: Working section (beta) and automatic settlement;
 * - **Behavior**: **Follow-up behavior**, Queue or Steer, with T3 Code's
 *   description for its default send shortcut (Playstead has no other);
 * - **Confirmations**: archive and delete;
 * - **Text generation**: the provider and model that write thread titles;
 * - the folded **Legacy features**: **Plan mode (legacy)** and **Sidebar
 *   (legacy)**, both off by default.
 *
 * The rest of General waits for its features and slice 5.
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
      <NewThreadsSection />
      <SettingsSection id="settings-organization" title="Organization">
        <SettingsSwitchRow
          id="working-shelf"
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
        <AutoSettleRows />
      </SettingsSection>
      <SettingsSection id="settings-behavior" title="Behavior">
        <SettingsRow
          id="follow-up-behavior"
          title="Follow-up behavior"
          description={`Queue follow-ups while the agent runs or steer the current run. Press ${
            /mac/i.test(navigator.platform) ? "⌘" : "Ctrl"
          } + Enter to do the opposite for one message.`}
          reset={{
            label: "follow-up behavior",
            isDefault: settings.followUpBehavior === DEFAULT_CLIENT_SETTINGS.followUpBehavior,
            onReset: () => save({ followUpBehavior: DEFAULT_CLIENT_SETTINGS.followUpBehavior }),
          }}
          control={
            <select
              aria-label="Follow-up behavior"
              value={settings.followUpBehavior}
              onChange={(event) => {
                const value = ACTIVE_TURN_COMPOSER_ACTIONS.find(
                  (action) => action === event.target.value,
                );
                if (value !== undefined) void save({ followUpBehavior: value });
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
      </SettingsSection>
      <SettingsSection id="settings-confirmations" title="Confirmations">
        <SettingsSwitchRow
          id="unpin-confirmation"
          title="Unpin confirmation"
          description="Ask before unpinning a thread from the pinned section."
          ariaLabel="Confirm thread unpinning"
          checked={settings.confirmThreadUnpin}
          isDefault={settings.confirmThreadUnpin === DEFAULT_CLIENT_SETTINGS.confirmThreadUnpin}
          onChange={(confirmThreadUnpin) => save({ confirmThreadUnpin })}
        />
        <SettingsSwitchRow
          id="archive-confirmation"
          title="Archive confirmation"
          description="Ask before archiving a thread."
          ariaLabel="Confirm thread archiving"
          checked={settings.confirmThreadArchive}
          isDefault={settings.confirmThreadArchive === DEFAULT_CLIENT_SETTINGS.confirmThreadArchive}
          onChange={(confirmThreadArchive) => save({ confirmThreadArchive })}
        />
        <SettingsSwitchRow
          id="delete-confirmation"
          title="Delete confirmation"
          description="Ask before deleting a thread and its chat history."
          ariaLabel="Confirm thread deletion"
          checked={settings.confirmThreadDelete}
          isDefault={settings.confirmThreadDelete === DEFAULT_CLIENT_SETTINGS.confirmThreadDelete}
          onChange={(confirmThreadDelete) => save({ confirmThreadDelete })}
        />
      </SettingsSection>
      <TextGenerationSection />
      <details className="group flex flex-col gap-2">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100">
          <h2 className="font-normal">Legacy features</h2>
          <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        </summary>
        <div className="mt-2 divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          <SettingsSwitchRow
            id="legacy-plan-mode"
            title="Plan mode (legacy)"
            description="Restore Build/Plan, /plan, /default, and Shift+Tab. Off uses build mode."
            ariaLabel="Plan mode (legacy)"
            checked={settings.planModeEnabled}
            isDefault={settings.planModeEnabled === DEFAULT_CLIENT_SETTINGS.planModeEnabled}
            onChange={(planModeEnabled) => save({ planModeEnabled })}
          />
          <SettingsSwitchRow
            id="legacy-sidebar"
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

const FOLLOW_UP_LABELS: Record<FollowUpBehavior, string> = { queue: "Queue", steer: "Steer" };

/**
 * **New threads** (T3 Code's `ProjectDefaultsSettings` on General): the
 * permissions a new thread starts with, a server setting.
 */
function NewThreadsSection() {
  const settings = usePrimaryConnectionState()?.config?.settings;
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  return (
    <SettingsSection id="settings-new-threads" title="New threads">
      {settings === undefined ? (
        <p className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400">
          Connecting to the server…
        </p>
      ) : (
        <SettingsRow
          id="default-permissions"
          title="Permissions"
          description="Default permissions for new threads."
          reset={{
            label: "default permissions",
            isDefault: settings.defaultRuntimeMode === DEFAULT_SERVER_SETTINGS.defaultRuntimeMode,
            onReset: () =>
              void saveServerSettings({
                defaultRuntimeMode: DEFAULT_SERVER_SETTINGS.defaultRuntimeMode,
              }),
          }}
          control={
            <RuntimeModePicker
              variant="setting"
              mode={settings.defaultRuntimeMode}
              open={permissionsOpen}
              onOpenChange={setPermissionsOpen}
              onSelect={(defaultRuntimeMode) => void saveServerSettings({ defaultRuntimeMode })}
            />
          }
        />
      )}
    </SettingsSection>
  );
}

/**
 * Automatic settlement's rows (T3 Code's **Auto-settle inactive threads** and
 * **Days of inactivity before auto-settle** in `SettingsPanels.tsx`): the
 * switch turns `sidebarAutoSettleAfterDays` off (null) or back to 3 days,
 * and while it is on the days field sets it. A server setting. T3 Code's
 * merge and pull-request rows have no place in Playstead.
 */
function AutoSettleRows() {
  const config = usePrimaryConnectionState()?.config;
  const afterDays = config?.settings.sidebarAutoSettleAfterDays;
  const save = (sidebarAutoSettleAfterDays: number | null) =>
    saveServerSettings({ sidebarAutoSettleAfterDays });
  if (afterDays === undefined) return null;
  return (
    <>
      <div id="auto-settle-inactive-threads" className="flex items-center gap-4 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Auto-settle inactive threads</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            Sidebar threads with no activity for this long settle automatically.
          </div>
        </div>
        {afterDays === DEFAULT_SERVER_SETTINGS.sidebarAutoSettleAfterDays ? null : (
          <button
            type="button"
            aria-label="Reset auto-settle to default"
            onClick={() => void save(DEFAULT_SERVER_SETTINGS.sidebarAutoSettleAfterDays)}
            className="text-xs text-neutral-500 hover:underline dark:text-neutral-400"
          >
            Reset
          </button>
        )}
        <Switch
          ariaLabel="Auto-settle inactive threads"
          checked={afterDays !== null}
          onChange={(checked) => void save(checked ? DEFAULT_SIDEBAR_AUTO_SETTLE_AFTER_DAYS : null)}
        />
      </div>
      {afterDays === null ? null : (
        <div className="flex items-center gap-4 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Days of inactivity before auto-settle</div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Any new activity un-settles a thread automatically.
            </div>
          </div>
          <AutoSettleDaysInput value={afterDays} onCommit={(days) => void save(days)} />
        </div>
      )}
    </>
  );
}

/** Commits each valid entry, and shows the saved days again on blur (T3 Code's `AutoSettleDaysInput`). */
function AutoSettleDaysInput(props: {
  readonly value: number;
  readonly onCommit: (days: number) => void;
}) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => {
    setDraft(String(props.value));
  }, [props.value]);
  return (
    <input
      type="number"
      min={MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
      max={MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
      aria-label="Days of inactivity before auto-settle"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        const days = parseAutoSettleDays(event.target.value);
        if (days !== null && days !== props.value) props.onCommit(days);
      }}
      onBlur={() => setDraft(String(props.value))}
      className="w-24 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
    />
  );
}

const sameSelection = (left: ModelSelection, right: ModelSelection) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * **Text generation** (T3 Code's section of that name in
 * `SettingsPanels.tsx`): the model picker over the installed providers,
 * standing on the fallback when the chosen provider cannot run, and
 * **Reset** while the setting is off T3 Code's default. A server setting.
 * Choosing reasoning effort and the other options is not offered here yet.
 */
function TextGenerationSection() {
  const config = usePrimaryConnectionState()?.config;
  const save = (textGenerationModelSelection: ModelSelection) =>
    saveServerSettings({ textGenerationModelSelection }, "Text generation model not saved");
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
    <SettingsSection id="settings-text-generation" title="Text generation">
      <SettingsRow
        id="text-generation-model"
        title="Text generation model"
        description="Used for thread titles."
        reset={{
          label: "text generation model",
          isDefault,
          onReset: () => void save(DEFAULT_SERVER_SETTINGS.textGenerationModelSelection),
        }}
        control={
          config === undefined ? (
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
          )
        }
      />
    </SettingsSection>
  );
}

/** A titled group of rows (T3 Code's `SettingsSection`). */
function SettingsSection(props: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={props.id} className="flex flex-col gap-2">
      <h2 id={props.id} className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
        {props.title}
      </h2>
      <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {props.children}
      </div>
    </section>
  );
}

/**
 * A setting's row: its title, description and control, and **Reset** while
 * it is off its default (T3 Code's `SettingsRow` and `SettingResetButton`).
 */
function SettingsRow(props: {
  /** Where the command palette's settings search opens the page. */
  readonly id: string;
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
    <div id={props.id} className="flex items-center gap-4 px-4 py-3">
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

/** A row with a switch, and **Reset** while it is off its default. */
function SettingsSwitchRow(props: {
  readonly id: string;
  readonly title: string;
  readonly description: ReactNode;
  readonly ariaLabel: string;
  readonly checked: boolean;
  readonly isDefault: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <SettingsRow
      id={props.id}
      title={props.title}
      description={props.description}
      reset={{
        label: props.title,
        isDefault: props.isDefault,
        onReset: () => props.onChange(!props.checked),
      }}
      control={
        <Switch ariaLabel={props.ariaLabel} checked={props.checked} onChange={props.onChange} />
      }
    />
  );
}

/** An on/off setting (T3 Code's `Switch`). */
function Switch(props: {
  readonly ariaLabel: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
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
  );
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60_000],
  ["month", 30 * 24 * 60 * 60_000],
  ["day", 24 * 60 * 60_000],
  ["hour", 60 * 60_000],
  ["minute", 60_000],
];

/** "5 minutes ago", as T3 Code's `formatRelativeTimeLabel` reads. */
const formatRelative = (iso: string): string => {
  const elapsed = Date.parse(iso) - Date.now();
  for (const [unit, size] of UNITS) {
    if (Math.abs(elapsed) >= size) return relativeTime.format(Math.round(elapsed / size), unit);
  }
  return "just now";
};

/**
 * **Settings → Archive** (T3 Code's `ArchivedThreadsPanel` in
 * `apps/web/src/components/settings/SettingsPanels.tsx` at 2577baf): the
 * archived threads by project, newest archived first, each with
 * **Unarchive** and, in its menu, **Unarchive** and **Delete**.
 */
export function ArchivedThreadsPanel() {
  const archive = useArchivedThreads();
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  const groups = useMemo(
    () => (archive === undefined ? [] : groupArchivedThreadsByProject(archive)),
    [archive],
  );

  const unarchive = (thread: OrchestrationV2ThreadShell) =>
    unarchiveThread(thread.id).catch((error: unknown) =>
      failureToast("Failed to unarchive thread", error),
    );

  const openMenu = async (thread: OrchestrationV2ThreadShell, x: number, y: number) => {
    const chosen = await readLocalApi()
      .contextMenu.show(archivedThreadMenuItems, { x, y })
      .catch(() => null);
    if (chosen === "unarchive") await unarchive(thread);
    if (chosen === "delete") {
      await confirmAndDeleteThread(thread).catch((error: unknown) =>
        failureToast("Failed to delete thread", error),
      );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 id="archive" className="text-xl font-semibold">
        Archive
      </h1>
      {groups.length === 0 ? (
        <section className="rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="text-sm font-medium">
            {archive === undefined ? "Loading archived threads" : "No archived threads"}
          </div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            {archive === undefined ? "Checking the server." : "Archived threads will appear here."}
          </div>
        </section>
      ) : (
        groups.map(({ project, threads }) => (
          <section key={project.id} aria-label={project.title} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
              {project.title}
            </h2>
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {threads.map((thread) => (
                <li
                  key={thread.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void openMenu(thread, event.clientX, event.clientY);
                  }}
                  className="flex items-center gap-4 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{thread.title}</div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400">
                      Archived {formatRelative(thread.archivedAt ?? thread.createdAt)}
                      {" · Created "}
                      {formatRelative(thread.createdAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void unarchive(thread)}
                    className="shrink-0 rounded-md border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    Unarchive
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

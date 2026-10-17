import { useState } from "react";
import { requestPrimary, usePrimaryConnectionState } from "../../connection/runtime.ts";
import { failureToast } from "../../toast.ts";

/** General's server-owned inactivity policy; null means never. */
export function AutoSettleSettings() {
  const config = usePrimaryConnectionState()?.config;
  const saved = config?.settings.sidebarAutoSettleAfterDays;
  const days = saved === undefined ? 3 : saved;
  const [saving, setSaving] = useState(false);
  const save = async (value: number | null) => {
    setSaving(true);
    try {
      await requestPrimary((client) =>
        client["server.updateSettings"]({ sidebarAutoSettleAfterDays: value }),
      );
    } catch (error) {
      failureToast("Failed to save auto-settle settings", error);
    } finally {
      setSaving(false);
    }
  };
  return (
    <fieldset disabled={!config || saving} className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Auto-settle inactive threads</div>
        <p className="text-xs text-neutral-500">
          Settle inactive threads automatically. Pinned, snoozed and working threads stay active.
        </p>
      </div>
      {days !== 3 && (
        <button type="button" className="text-xs hover:underline" onClick={() => void save(3)}>
          Reset
        </button>
      )}
      {days === null ? (
        <span className="text-sm text-neutral-500">Never</span>
      ) : (
        <label className="flex items-center gap-2 text-sm">
          <input
            key={days}
            id="auto-settle-days"
            type="number"
            min={1}
            max={90}
            step={1}
            aria-label="Days of inactivity before auto-settle"
            defaultValue={days}
            className="w-16 rounded-md border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
            onBlur={(event) => {
              const next = event.currentTarget.valueAsNumber;
              if (Number.isInteger(next) && next >= 1 && next <= 90 && next !== days)
                void save(next);
              else event.currentTarget.value = String(days);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />{" "}
          days
        </label>
      )}
      <button
        type="button"
        role="switch"
        aria-label="Auto-settle inactive threads"
        aria-checked={days !== null}
        onClick={() => void save(days === null ? 3 : null)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full ${days !== null ? "bg-sky-600" : "bg-neutral-300 dark:bg-neutral-700"}`}
      >
        <span
          className={`inline-block size-4 rounded-full bg-white shadow ${days !== null ? "translate-x-4.5" : "translate-x-0.5"}`}
        />
      </button>
    </fieldset>
  );
}

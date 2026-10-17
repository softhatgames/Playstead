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
        <label htmlFor="auto-settle-days" className="text-sm font-medium">
          Auto-settle after N days
        </label>
        <p className="text-xs text-neutral-500">
          Settle inactive threads automatically. Pinned, snoozed and working threads stay active.
        </p>
      </div>
      {days !== 3 && (
        <button type="button" className="text-xs hover:underline" onClick={() => void save(3)}>
          Reset
        </button>
      )}
      <select
        id="auto-settle-days"
        aria-label="Auto-settle after N days"
        value={days ?? "never"}
        className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
        onChange={(event) =>
          void save(event.target.value === "never" ? null : Number(event.target.value))
        }
      >
        <option value="never">Never</option>
        {![1, 3, 7, 14, 30, 90, null].includes(days) && (
          <option value={days ?? "never"}>{days} days</option>
        )}
        {[1, 3, 7, 14, 30, 90].map((value) => (
          <option key={value} value={value}>
            {value} {value === 1 ? "day" : "days"}
          </option>
        ))}
      </select>
    </fieldset>
  );
}

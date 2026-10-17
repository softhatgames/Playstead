import type { SnoozePreset } from "@playstead/client-runtime/state/threadSettled";
import type { ContextMenuItem } from "@playstead/contracts/ipc";

/**
 * The sidebar's snooze choices (T3 Code's `apps/web/src/components/Sidebar.snooze.ts`
 * at 2577baf), shared by the thread menu, the bulk menu and the row's
 * hover Clock.
 */

/** A snooze choice in a menu: a preset by its id, or **Custom…**. */
export type SnoozeMenuId = `snooze:${string}`;

/** Each preset as "In 1 hour (3:00 PM)", then **Custom…**. */
export const snoozeMenuChildren = (
  presets: ReadonlyArray<SnoozePreset>,
): ReadonlyArray<ContextMenuItem<SnoozeMenuId>> => [
  ...presets.map((preset) => ({
    id: `snooze:${preset.id}` as const,
    label: `${preset.label} (${preset.whenLabel})`,
  })),
  { id: "snooze:custom", label: "Custom…", separatorBefore: true },
];

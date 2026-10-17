import {
  MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
} from "@playstead/contracts/settings";

/**
 * The days a **Days of inactivity before auto-settle** entry commits, or null
 * while it is not yet whole days within the bounds (T3 Code's
 * `AutoSettleDaysInput` in `apps/web/src/components/settings/SettingsPanels.tsx`
 * at 2577baf commits on each valid keystroke and restores the saved value on
 * blur).
 */
export function parseAutoSettleDays(text: string): number | null {
  if (text.trim().length === 0) return null;
  const days = Number(text);
  return Number.isInteger(days) &&
    days >= MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS &&
    days <= MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS
    ? days
    : null;
}

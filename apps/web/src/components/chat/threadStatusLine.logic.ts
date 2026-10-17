import { effectiveSnoozed, threadWokeAt } from "@playstead/client-runtime/state/threadSettled";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

import { formatRelativeTimeLabel } from "../CommandPalette.logic.ts";

/**
 * The thread view's status line above the composer (T3 Code's
 * `threadStatusLine` and `ThreadStatusLine` in `apps/web/src/components/ChatView.tsx`
 * and `components/chat/ThreadStatusLine.tsx` at 2577baf): a snoozed thread
 * says how long is left, with **Wake now**; a settled one when it settled,
 * with **Un-settle**; one that woke from a snooze says so until it is seen
 * after the wake, with **Dismiss**.
 */
export type ThreadStatusLine =
  | { readonly kind: "snoozed"; readonly label: string; readonly action: "Wake now" }
  | { readonly kind: "settled"; readonly label: string; readonly action: "Un-settle" }
  | {
      readonly kind: "woke";
      readonly label: "Woke from snooze";
      readonly action: "Dismiss";
      /** What **Dismiss** visits the thread at. */
      readonly wokeAt: string;
    };

const SECOND_MS = 1_000;

/** Time left until `iso`: "Soon", "45s left", "12m left", "2h left", "3d left" (T3 Code's `formatRelativeTimeUntilLabel`). */
function formatRelativeTimeUntilLabel(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const diff = at - now;
  if (diff <= 0) return "Expired";
  const seconds = Math.floor(diff / SECOND_MS);
  if (seconds < 5) return "Soon";
  if (seconds < 60) return `${seconds}s left`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h left`;
  return `${Math.floor(hours / 24)}d left`;
}

const millisOf = (iso: string | null): number =>
  iso === null ? Number.NEGATIVE_INFINITY : Date.parse(iso);

export function resolveThreadStatusLine(input: {
  readonly thread: Pick<
    OrchestrationV2ThreadShell,
    | "status"
    | "latestRunCompletedAt"
    | "lastVisitedAt"
    | "settledOverride"
    | "settledAt"
    | "snoozedUntil"
    | "snoozedAt"
    | "hasPendingUserInput"
  >;
  readonly now: number;
}): ThreadStatusLine | null {
  const { thread, now } = input;
  const nowIso = new Date(now).toISOString();
  if (thread.snoozedUntil !== null && effectiveSnoozed(thread, { now: nowIso })) {
    return {
      kind: "snoozed",
      label: `Snoozed, ${formatRelativeTimeUntilLabel(thread.snoozedUntil, now)}`,
      action: "Wake now",
    };
  }
  if (thread.settledOverride === "settled") {
    return {
      kind: "settled",
      label:
        thread.settledAt === null
          ? "Settled"
          : `Settled ${formatRelativeTimeLabel(thread.settledAt, now)}`,
      action: "Un-settle",
    };
  }
  const wokeAt = threadWokeAt(thread, { now: nowIso });
  if (wokeAt === null) return null;
  // Seen after the wake: visited, or its latest run ended, since.
  const seenAt = Math.max(millisOf(thread.lastVisitedAt), millisOf(thread.latestRunCompletedAt));
  return seenAt < Date.parse(wokeAt)
    ? { kind: "woke", label: "Woke from snooze", action: "Dismiss", wokeAt }
    : null;
}

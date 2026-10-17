import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { useEffect, useState } from "react";

import { unsettleThread, unsnoozeThread, visitThread } from "../../hooks/useThreadActions.ts";
import { AlarmClockIcon, CircleCheckIcon } from "../icons.tsx";
import { failureToast } from "../ui/toast.tsx";
import { resolveThreadStatusLine } from "./threadStatusLine.logic.ts";

// The longest delay `setTimeout` takes; a later wake is checked again then.
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MINUTE_MS = 60_000;

/**
 * Re-renders each minute, and just after the thread's snooze runs out, so
 * the line's times and its snoozed state stay current (T3 Code's
 * `useNowMinute` and `snoozeWakeTick` in `ChatView.tsx`).
 */
function useStatusLineClock(snoozedUntil: string | null): void {
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (snoozedUntil === null) return;
    const wakeAt = Date.parse(snoozedUntil);
    if (Number.isNaN(wakeAt) || wakeAt <= Date.now()) return;
    const delay = Math.min(wakeAt - Date.now() + 50, MAX_TIMER_DELAY_MS);
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [snoozedUntil]);
}

/**
 * The thread view's status line above the composer (T3 Code's
 * `components/chat/ThreadStatusLine.tsx` at 2577baf): "Snoozed, 2h left ·
 * Wake now", "Settled 3h ago · Un-settle", or "Woke from snooze · Dismiss".
 */
export function ThreadStatusLine({
  thread,
}: {
  readonly thread: OrchestrationV2ThreadShell | undefined;
}) {
  useStatusLineClock(thread?.snoozedUntil ?? null);
  const [pending, setPending] = useState<string | null>(null);
  if (thread === undefined) return null;
  const line = resolveThreadStatusLine({ thread, now: Date.now() });
  if (line === null) return null;
  const busy = pending === `${thread.id}:${line.kind}`;
  const run = (action: () => Promise<unknown>, failureTitle: string) => {
    const key = `${thread.id}:${line.kind}`;
    setPending(key);
    action()
      .catch((error: unknown) => failureToast(failureTitle, error))
      .finally(() => setPending((current) => (current === key ? null : current)));
  };
  const onAction = () => {
    switch (line.kind) {
      case "snoozed":
        return run(() => unsnoozeThread(thread.id), "Failed to wake thread");
      case "settled":
        return run(() => unsettleThread(thread.id), "Failed to un-settle thread");
      case "woke":
        // T3 Code's acknowledgement does not report a failure either.
        visitThread(thread.id, line.wokeAt).catch(() => undefined);
        return;
    }
  };
  const actionLabel = busy
    ? line.kind === "snoozed"
      ? "Waking..."
      : "Un-settling..."
    : line.action;
  return (
    <div
      data-chat-thread-status-line="true"
      className="mx-auto flex w-full max-w-3xl min-w-0 items-center gap-1.5 px-5 pb-2 text-xs text-neutral-500 dark:text-neutral-400"
    >
      {line.kind === "settled" ? (
        <CircleCheckIcon className="size-3.5 shrink-0" />
      ) : (
        <AlarmClockIcon className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 truncate">{line.label}</span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        disabled={busy}
        onClick={onAction}
        className="font-medium underline-offset-2 hover:text-neutral-900 hover:underline disabled:opacity-60 dark:hover:text-neutral-100"
      >
        {actionLabel}
      </button>
    </div>
  );
}

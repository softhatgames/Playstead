import type { ThreadId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

import { threadAfterPark } from "../components/Sidebar.logic.ts";
import { failureToast } from "../components/ui/toast.tsx";
import { readPrimaryServerSettings } from "../connection/runtime.ts";
import { createDraft } from "../drafts.ts";
import { registerSnoozeAndAdvance } from "../snoozeAndAdvance.ts";
import { registerSettleAndAdvance } from "../settleAndAdvance.ts";
import { settleThread, snoozeThread } from "./useThreadActions.ts";

type SidebarThread = OrchestrationV2ThreadShell;

type SettleTarget = Pick<
  SidebarThread,
  "id" | "projectId" | "pinnedAt" | "pinOrderKey" | "snoozedUntil"
>;

/**
 * Settling and snoozing from the inbox (T3 Code's `attemptSettle`,
 * `performSnooze` and `planForwardNavigation` in `Sidebar.tsx`): parking
 * the thread in view moves the view to the next thread that is not
 * settled or snoozed, or to a new draft in its project. Settling from the
 * thread menu or `mod+shift+s` comes here too while the inbox is shown
 * (`registerSettleAndAdvance`).
 */
export function useSidebarParking(input: {
  /** The rows in the order shown. */
  readonly orderedIds: ReadonlyArray<string>;
  /** Settled and snoozed threads: the view does not move to them. */
  readonly parkedIds: ReadonlySet<string>;
  readonly threadsById: ReadonlyMap<string, SidebarThread>;
  readonly routeThreadId: string | undefined;
}) {
  const navigate = useNavigate();
  // Read when an action runs, so the callbacks stay the same between renders.
  const latest = useRef(input);
  latest.current = input;

  const planForwardNavigation = useCallback(
    (thread: Pick<SidebarThread, "id" | "projectId">, coParking?: ReadonlySet<string>) => {
      const { orderedIds, parkedIds, routeThreadId } = latest.current;
      if (routeThreadId !== thread.id) return () => undefined;
      const next = threadAfterPark({
        orderedIds,
        parkedIds,
        threadId: thread.id,
        ...(coParking === undefined ? {} : { coParkingIds: coParking }),
      });
      return () => {
        if (latest.current.routeThreadId !== thread.id) return;
        void (next === null
          ? navigate({
              to: "/draft/$draftId",
              params: { draftId: createDraft(thread.projectId, readPrimaryServerSettings()) },
            })
          : navigate({ to: "/threads/$threadId", params: { threadId: next as ThreadId } }));
      };
    },
    [navigate],
  );

  /** Settles a thread with `coSettling`; resolves with whether it settled, a failure showing its notice. */
  const attemptSettle = useCallback(
    (thread: SettleTarget, coSettling?: ReadonlySet<string>): Promise<boolean> => {
      const moveOn = planForwardNavigation(thread, coSettling);
      return settleThread(thread).then(
        () => {
          moveOn();
          return true;
        },
        (error: unknown) => {
          failureToast("Failed to settle thread", error);
          return false;
        },
      );
    },
    [planForwardNavigation],
  );

  /** Snoozes a thread until `snoozedUntil`; resolves with the failure, if any, for the caller to report. */
  const performSnooze = useCallback(
    async (
      thread: SidebarThread,
      snoozedUntil: string,
      coSnoozing?: ReadonlySet<string>,
    ): Promise<{ readonly error: unknown } | null> => {
      const moveOn = planForwardNavigation(thread, coSnoozing);
      try {
        await snoozeThread(thread, snoozedUntil);
      } catch (error) {
        return { error };
      }
      moveOn();
      return null;
    },
    [planForwardNavigation],
  );

  const attemptSnooze = useCallback(
    (thread: SidebarThread, snoozedUntil: string) => {
      void performSnooze(thread, snoozedUntil).then((failure) => {
        if (failure !== null) failureToast("Failed to snooze thread", failure.error);
      });
    },
    [performSnooze],
  );

  /** Snoozes the selected threads together (T3 Code's bulk **Snooze**), with one notice for failures. */
  const snoozeThreads = useCallback(
    (targets: ReadonlyArray<SidebarThread>, snoozedUntil: string) => {
      const coSnoozing = new Set<string>(targets.map((thread) => thread.id));
      void Promise.all(
        targets.map((thread) => performSnooze(thread, snoozedUntil, coSnoozing)),
      ).then((outcomes) => {
        const failures = outcomes.filter((outcome) => outcome !== null);
        if (failures.length === 0) return;
        failureToast(
          failures.length < targets.length
            ? `Failed to snooze ${failures.length} thread${failures.length === 1 ? "" : "s"}`
            : "Failed to snooze threads",
          failures[0]!.error,
        );
      });
    },
    [performSnooze],
  );

  const settleThreads = useCallback(
    (targets: ReadonlyArray<SidebarThread>) => {
      const coSettling = new Set<string>(targets.map((thread) => thread.id));
      for (const thread of targets) void attemptSettle(thread, coSettling);
    },
    [attemptSettle],
  );

  useEffect(
    () =>
      registerSettleAndAdvance((target) => {
        const thread = latest.current.threadsById.get(target.id);
        if (thread !== undefined) void attemptSettle(thread);
      }),
    [attemptSettle],
  );

  useEffect(
    () =>
      registerSnoozeAndAdvance((target, until) => {
        const thread = latest.current.threadsById.get(target.id);
        if (thread === undefined) return false;
        attemptSnooze(thread, until);
        return true;
      }),
    [attemptSnooze],
  );

  return { attemptSettle, attemptSnooze, snoozeThreads, settleThreads };
}

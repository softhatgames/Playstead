import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

/** How long the thread view waits between visits for activity other than a completion. */
export const VISIT_DISPATCH_THROTTLE_MS = 10_000;

export type ThreadVisitDecision =
  | { readonly kind: "none" }
  | { readonly kind: "now"; readonly key: string; readonly visitedAt: string }
  | {
      readonly kind: "later";
      readonly delayMs: number;
      readonly key: string;
      readonly visitedAt: string;
    };

/**
 * Whether the thread in view sends `thread.visit`, after T3 Code's visit
 * effect in `apps/web/src/components/ChatView.tsx` at 2577baf. The visit is
 * at the thread's last activity (`updatedAt`), and is skipped once the read
 * marker has reached it. Each activity is visited once (`key`): Mark unread
 * on the open thread leaves `updatedAt`, so the visit already sent for it
 * keeps the thread unread until new activity or the thread is opened again.
 * A completion not yet seen is visited at once; other activity at most every
 * ten seconds.
 */
export function resolveThreadVisit(input: {
  readonly thread: Pick<
    OrchestrationV2ThreadShell,
    "id" | "updatedAt" | "lastVisitedAt" | "latestRunCompletedAt"
  >;
  readonly lastDispatchedKey: string | null;
  readonly lastDispatchAt: number;
  readonly now: number;
}): ThreadVisitDecision {
  const { thread } = input;
  const updatedAt = Date.parse(thread.updatedAt);
  if (Number.isNaN(updatedAt)) return { kind: "none" };
  const lastVisitedAt = thread.lastVisitedAt === null ? NaN : Date.parse(thread.lastVisitedAt);
  if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= updatedAt) return { kind: "none" };

  const key = `${thread.id}:${thread.updatedAt}`;
  if (input.lastDispatchedKey === key) return { kind: "none" };
  const visit = { key, visitedAt: thread.updatedAt };
  const completedAt =
    thread.latestRunCompletedAt === null ? NaN : Date.parse(thread.latestRunCompletedAt);
  const completionUnseen =
    !Number.isNaN(completedAt) && (Number.isNaN(lastVisitedAt) || completedAt > lastVisitedAt);
  const elapsed = input.now - input.lastDispatchAt;
  if (completionUnseen || elapsed >= VISIT_DISPATCH_THROTTLE_MS) return { kind: "now", ...visit };
  return { kind: "later", delayMs: VISIT_DISPATCH_THROTTLE_MS - elapsed, ...visit };
}

import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

/**
 * Settling from the thread view or the keyboard goes through the inbox
 * sidebar while it is shown, so the view moves on to the next thread as it
 * does from a row (T3 Code's `apps/web/src/settleAndAdvance.ts` at 2577baf).
 */

type SettleTarget = Pick<OrchestrationV2ThreadShell, "id" | "pinnedAt" | "pinOrderKey">;
type SettleAndAdvance = (thread: SettleTarget) => void;

let registered: SettleAndAdvance | null = null;

export function registerSettleAndAdvance(handler: SettleAndAdvance): () => void {
  registered = handler;
  return () => {
    if (registered === handler) registered = null;
  };
}

/** False when no inbox sidebar is shown, so the caller settles in place. */
export function settleAndAdvance(thread: SettleTarget): boolean {
  if (registered === null) return false;
  registered(thread);
  return true;
}

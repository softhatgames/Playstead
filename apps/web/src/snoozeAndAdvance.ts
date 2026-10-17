import type { ThreadId } from "@playstead/contracts/baseSchemas";

/** The mounted inbox owns navigation after parking the viewed thread. */
let handler: ((threadId: ThreadId, until: string) => void) | null = null;
export function registerSnoozeAndAdvance(next: NonNullable<typeof handler>): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}
export function snoozeAndAdvance(threadId: ThreadId, until: string): boolean {
  if (handler === null) return false;
  handler(threadId, until);
  return true;
}

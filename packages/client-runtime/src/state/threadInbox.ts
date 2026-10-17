import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

/**
 * The inbox sidebar's Working shelf (T3 Code's
 * `packages/client-runtime/src/state/threadInbox.ts` at 2577baf): which
 * threads are at work, and, while the shelf is on, the order of Working
 * and of Active by when each thread last came back to the person.
 */

type ThreadShell = OrchestrationV2ThreadShell;

const timeOf = (iso: string | null): number => {
  if (iso === null) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
};

const byId = (left: Pick<ThreadShell, "id">, right: Pick<ThreadShell, "id">) =>
  left.id.localeCompare(right.id);

/**
 * Whether the thread's agent is at work, so the Working shelf takes it: its
 * run is starting or running. A run waiting on the person comes back to
 * Active, as it needs them.
 */
export const isThreadWorking = (thread: Pick<ThreadShell, "status">): boolean =>
  thread.status === "starting" || thread.status === "running";

/**
 * Active with the Working shelf on: by when each thread last came back to
 * the person. It was created, un-settled, sent work or finished it, or was
 * seen to stop working (`returnedAt`).
 */
export function sortInboxThreadsByReturn<
  T extends Pick<
    ThreadShell,
    "id" | "createdAt" | "unsettledAt" | "latestRunRequestedAt" | "latestRunCompletedAt"
  >,
>(threads: ReadonlyArray<T>, returnedAt: (thread: T) => number | undefined = () => undefined): T[] {
  const returned = (thread: T) =>
    Math.max(
      timeOf(thread.createdAt),
      timeOf(thread.unsettledAt),
      timeOf(thread.latestRunRequestedAt),
      timeOf(thread.latestRunCompletedAt),
      returnedAt(thread) ?? 0,
    );
  return [...threads].sort((left, right) => returned(right) - returned(left) || byId(left, right));
}

/** The Working shelf, the thread last sent work first. */
export function sortWorkingThreadsBySend<
  T extends Pick<ThreadShell, "id" | "createdAt" | "latestRunRequestedAt">,
>(threads: ReadonlyArray<T>): T[] {
  const sent = (thread: T) =>
    Math.max(timeOf(thread.createdAt), timeOf(thread.latestRunRequestedAt));
  return [...threads].sort((left, right) => sent(right) - sent(left) || byId(left, right));
}

/**
 * Remembers when each thread stopped working, so it can come back to the top
 * of Active. Keep one for the page; `observe` every list of threads, or null
 * while the shelf is off.
 */
export function createInboxReturnTracker() {
  let lastWorking: ReadonlySet<string> | null = null;
  const returns = new Map<string, number>();
  return {
    observe(threads: ReadonlyArray<Pick<ThreadShell, "id" | "status">> | null, now: number): void {
      if (threads === null) {
        lastWorking = null;
        returns.clear();
        return;
      }
      const present = new Set<string>(threads.map((thread) => thread.id));
      const working = new Set<string>(threads.filter(isThreadWorking).map((thread) => thread.id));
      for (const id of returns.keys()) if (!present.has(id)) returns.delete(id);
      for (const id of lastWorking ?? []) {
        if (present.has(id) && !working.has(id)) returns.set(id, now);
      }
      lastWorking = working;
    },
    returnedAt: (thread: Pick<ThreadShell, "id">) => returns.get(thread.id),
  };
}

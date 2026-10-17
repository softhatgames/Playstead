import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

/**
 * How threads are ordered (T3 Code's
 * `packages/client-runtime/src/state/threadSort.ts` at 2577baf): newest
 * first for the palette and the project tree, each inbox section's order,
 * and the order keys that arrange pinned and active threads.
 */

type ThreadShell = OrchestrationV2ThreadShell;

const timeOf = (iso: string | null): number => {
  if (iso === null) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
};

const compareKeys = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const byId = (left: Pick<ThreadShell, "id">, right: Pick<ThreadShell, "id">) =>
  left.id.localeCompare(right.id);

/**
 * Newest first, by the latest message sent (`updated_at`) or by creation
 * (`created_at`). The shell has no latest-message time; the latest run's
 * request stands for it, as each message asks for a run, and a thread
 * without one falls back to `updatedAt`. Ties go to the larger id.
 */
export type ThreadSortOrder = "updated_at" | "created_at";

export type ThreadSortInput = Pick<
  ThreadShell,
  "id" | "createdAt" | "updatedAt" | "latestRunRequestedAt"
>;

export function threadSortTimestamp(thread: ThreadSortInput, order: ThreadSortOrder): number {
  return order === "created_at"
    ? timeOf(thread.createdAt)
    : timeOf(thread.latestRunRequestedAt) || timeOf(thread.updatedAt);
}

export function sortThreads<T extends ThreadSortInput>(
  threads: ReadonlyArray<T>,
  order: ThreadSortOrder,
): T[] {
  return threads.toSorted(
    (left, right) =>
      threadSortTimestamp(right, order) - threadSortTimestamp(left, order) ||
      right.id.localeCompare(left.id),
  );
}

/** Pinned threads by order key, then the keyless ones newest first. */
export function sortPinnedThreadsByOrderKey<
  T extends Pick<ThreadShell, "id" | "createdAt" | "pinOrderKey">,
>(threads: ReadonlyArray<T>): T[] {
  const keyed = threads.filter((thread) => thread.pinOrderKey !== null);
  const keyless = threads.filter((thread) => thread.pinOrderKey === null);
  keyed.sort(
    (left, right) => compareKeys(left.pinOrderKey!, right.pinOrderKey!) || byId(left, right),
  );
  keyless.sort(
    (left, right) => timeOf(right.createdAt) - timeOf(left.createdAt) || byId(left, right),
  );
  return [...keyed, ...keyless];
}

/**
 * Active threads: the ones not yet arranged on top, newest first by when
 * they were created or un-settled, then the arranged ones by order key.
 * Activity does not reorder them.
 */
export function sortActiveThreadsByOrderKey<
  T extends Pick<ThreadShell, "id" | "createdAt" | "unsettledAt" | "activeOrderKey">,
>(threads: ReadonlyArray<T>): T[] {
  const anchor = (thread: T) => Math.max(timeOf(thread.createdAt), timeOf(thread.unsettledAt));
  return [...threads].sort((left, right) => {
    const leftKey = left.activeOrderKey;
    const rightKey = right.activeOrderKey;
    if (leftKey === null && rightKey !== null) return -1;
    if (leftKey !== null && rightKey === null) return 1;
    const order =
      leftKey !== null && rightKey !== null
        ? compareKeys(leftKey, rightKey)
        : anchor(right) - anchor(left);
    return order || byId(left, right);
  });
}

/**
 * Settled threads, newest settlement first, falling back to the latest
 * run's times for a thread without one.
 */
export function sortSettledThreads<
  T extends Pick<
    ThreadShell,
    "id" | "settledAt" | "latestRunRequestedAt" | "latestRunCompletedAt" | "updatedAt"
  >,
>(threads: ReadonlyArray<T>): T[] {
  const settledTime = (thread: T) =>
    thread.settledAt !== null
      ? timeOf(thread.settledAt)
      : Math.max(timeOf(thread.latestRunRequestedAt), timeOf(thread.latestRunCompletedAt)) ||
        timeOf(thread.updatedAt);
  return [...threads].sort(
    (left, right) => settledTime(right) - settledTime(left) || byId(left, right),
  );
}

/*
 * The order keys. A key is a string of the digits a–z read as a fraction
 * between 0 and 1, so there is always a key between two others; it never
 * ends in "a", which would leave nothing to sort before it. Only the client
 * makes keys; the server stores them as they come (`thread.pin`,
 * `thread.pin.reorder`, `thread.active.reorder`).
 */

const DIGITS = "abcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

const isOrderKey = (key: string): boolean =>
  key.length > 0 && [...key].every((char) => DIGITS.includes(char)) && !key.endsWith(DIGITS[0]!);

/** The key halfway between `low` and `high`, "" standing for 0 below or 1 above. */
function midpoint(low: string, high: string): string {
  if (high !== "") {
    // Keep the digits both share, reading a missing digit of `low` as "a".
    let shared = 0;
    while ((low[shared] ?? DIGITS[0]) === high[shared]) shared += 1;
    if (shared > 0) return high.slice(0, shared) + midpoint(low.slice(shared), high.slice(shared));
  }
  const lowDigit = low === "" ? 0 : DIGITS.indexOf(low[0]!);
  const highDigit = high === "" ? BASE : DIGITS.indexOf(high[0]!);
  if (highDigit - lowDigit > 1) return DIGITS[Math.round((lowDigit + highDigit) / 2)]!;
  // Neighbouring digits: a longer `high` has room below it at its first digit.
  if (high.length > 1) return high[0]!;
  return DIGITS[lowDigit]! + midpoint(low.slice(1), "");
}

/**
 * A key that sorts strictly between two neighbours, null meaning the top or
 * the bottom of the run. Null when a neighbour's key is not a valid key or
 * they are out of order: the caller then rewrites the whole section.
 */
export function pinOrderKeyBetween(before: string | null, after: string | null): string | null {
  const low = before ?? "";
  const high = after ?? "";
  if (low !== "" && !isOrderKey(low)) return null;
  if (high !== "" && !isOrderKey(high)) return null;
  if (high !== "" && low >= high) return null;
  return midpoint(low, high);
}

/**
 * `count` keys spread evenly, each with room before it: two digits, or more
 * when there are too many threads for two (T3 Code's
 * `generateSpreadPinOrderKeys`). A value that would end in "a" moves up one.
 */
export function spreadOrderKeys(count: number): string[] {
  let width = 2;
  while (BASE ** width <= (count + 1) * 2) width += 1;
  const step = BASE ** width / (count + 1);
  return Array.from({ length: count }, (_, index) => {
    let value = Math.round(step * (index + 1));
    if (value % BASE === 0) value += 1;
    let key = "";
    for (let place = 0; place < width; place += 1) {
      key = DIGITS[value % BASE]! + key;
      value = Math.floor(value / BASE);
    }
    return key;
  });
}

export interface OrderKeyAssignment {
  readonly id: string;
  readonly orderKey: string;
}

/**
 * The key writes that put `movedId` where it is in `orderedIds` (T3 Code's
 * `planPinnedReorder`), for Pinned or Active. One write when both
 * neighbours have keys, stepping past keys that threads not shown (another
 * project's, or snoozed) hold; otherwise every shown thread gets a fresh
 * spread key, none of them a hidden thread's, and only changed keys are
 * written. `keysById` holds every thread's key, shown or not.
 */
export function planThreadReorder(input: {
  readonly orderedIds: ReadonlyArray<string>;
  readonly keysById: ReadonlyMap<string, string | null>;
  readonly movedId: string;
}): ReadonlyArray<OrderKeyAssignment> {
  const { orderedIds, keysById, movedId } = input;
  const shown = new Set(orderedIds);
  const reserved = new Set<string>();
  for (const [id, key] of keysById) if (!shown.has(id) && key !== null) reserved.add(key);
  const index = orderedIds.indexOf(movedId);
  if (index === -1) return [];
  const neighbourKey = (id: string | undefined) =>
    id === undefined
      ? { usable: true, key: null }
      : { usable: keysById.get(id) != null, key: keysById.get(id) ?? null };
  const before = neighbourKey(orderedIds[index - 1]);
  const after = neighbourKey(orderedIds[index + 1]);
  if (before.usable && after.usable) {
    let key = pinOrderKeyBetween(before.key, after.key);
    while (key !== null && reserved.has(key)) key = pinOrderKeyBetween(key, after.key);
    if (key !== null) return [{ id: movedId, orderKey: key }];
  }
  const keys = spreadOrderKeys(orderedIds.length + reserved.size).filter(
    (key) => !reserved.has(key),
  );
  return orderedIds.flatMap((id, position) => {
    const orderKey = keys[position]!;
    return keysById.get(id) === orderKey ? [] : [{ id, orderKey }];
  });
}

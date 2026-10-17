/**
 * The order keys that arrange pinned and active threads (T3 Code's
 * `packages/client-runtime/src/state/threadSort.ts` at 2577baf). A key is
 * a string of the digits a–z read as a fraction between 0 and 1, so there
 * is always a key between two others; it never ends in "a", which would
 * leave nothing to sort before it. Only the client makes keys; the server
 * stores them as they come (`thread.pin`, `thread.pin.reorder`,
 * `thread.active.reorder`).
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

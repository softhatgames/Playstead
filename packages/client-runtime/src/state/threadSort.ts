/** Client-generated a–z fractional positions, following T3 Code's
 * packages/client-runtime/src/state/threadSort.ts at 2577baf. */
export function orderKeyBetween(before: string | null, after: string | null): string | null {
  const valid = (key: string | null) =>
    key === null || (/^[a-z]+$/.test(key) && !key.endsWith("a"));
  if (!valid(before) || !valid(after) || (before !== null && after !== null && before >= after))
    return null;
  let low = before ?? "";
  let high = after ?? "";
  let prefix = "";
  for (;;) {
    const a = low.length === 0 ? 0 : low.charCodeAt(0) - 97;
    const b = high.length === 0 ? 26 : high.charCodeAt(0) - 97;
    if (a === b) {
      prefix += String.fromCharCode(97 + a);
      low = low.slice(1);
      high = high.slice(1);
    } else if (b - a > 1) {
      return prefix + String.fromCharCode(97 + Math.round((a + b) / 2));
    } else if (high.length > 1) {
      return prefix + high[0];
    } else {
      prefix += String.fromCharCode(97 + a);
      low = low.slice(1);
      high = "";
    }
  }
}

/** Usually writes only the moved row. Keyless/corrupt neighbors require a
 * fresh run; keys retained by filtered-out threads remain reserved. */
export function planThreadReorder(
  order: ReadonlyArray<string>,
  keys: ReadonlyMap<string, string | null>,
  movedId: string,
): ReadonlyArray<{ id: string; orderKey: string }> {
  const index = order.indexOf(movedId);
  if (index < 0) return [];
  const visible = new Set(order);
  const reserved = new Set(
    [...keys].flatMap(([id, key]) => (!visible.has(id) && key !== null ? [key] : [])),
  );
  const before = index === 0 ? null : (keys.get(order[index - 1]!) ?? null);
  const after = index === order.length - 1 ? null : (keys.get(order[index + 1]!) ?? null);
  if ((index === 0 || before !== null) && (index === order.length - 1 || after !== null)) {
    let candidate = orderKeyBetween(before, after);
    while (candidate !== null && reserved.has(candidate))
      candidate = orderKeyBetween(candidate, after);
    if (candidate !== null) return [{ id: movedId, orderKey: candidate }];
  }
  // Spread the replacement positions across the alphabet, leaving room on both sides.
  let width = 2;
  while (26 ** width <= 2 * (order.length + reserved.size + 1)) width++;
  const step = 26 ** width / (order.length + reserved.size + 1);
  const available: string[] = [];
  for (let i = 1; available.length < order.length; i++) {
    let value = Math.round(i * step);
    if (value % 26 === 0) value++;
    let key = "";
    for (let digit = 0; digit < width; digit++) {
      key = String.fromCharCode(97 + (value % 26)) + key;
      value = Math.floor(value / 26);
    }
    if (!reserved.has(key)) available.push(key);
  }
  return order.flatMap((id, i) =>
    keys.get(id) === available[i] ? [] : [{ id, orderKey: available[i]! }],
  );
}

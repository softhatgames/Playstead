import { assert, describe, it } from "@effect/vitest";

import { parseAutoSettleDays } from "./autoSettleSettings.logic.ts";

describe("parseAutoSettleDays", () => {
  it("takes whole days from 1 to 90, as T3 Code's days field commits them", () => {
    assert.strictEqual(parseAutoSettleDays("1"), 1);
    assert.strictEqual(parseAutoSettleDays("7"), 7);
    assert.strictEqual(parseAutoSettleDays("90"), 90);
  });

  it("commits nothing for an empty, partial or out-of-range entry", () => {
    for (const text of ["", "0", "91", "2.5", "-3", "abc"]) {
      assert.isNull(parseAutoSettleDays(text), text);
    }
  });
});

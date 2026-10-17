import { assert, describe, it } from "@effect/vitest";

import { describeSessionWait, makeSessionWait } from "./sessionWait.ts";

/** A session check the test answers by hand, after reporting the server down or not. */
const pendingCheck = () => {
  let answer: (value: string) => void = () => {};
  let reportWaiting: () => void = () => {};
  const check = (onWaiting: () => void) => {
    reportWaiting = onWaiting;
    return new Promise<string>((resolve) => {
      answer = resolve;
    });
  };
  return { check, answer: (value: string) => answer(value), serverDown: () => reportWaiting() };
};

describe("waiting for the server", () => {
  it("says it is reconnecting once a check finds the server down, until the server answers", async () => {
    const wait = makeSessionWait();
    const seen: Array<string> = [];
    wait.subscribe(() => seen.push(describeSessionWait(wait.isWaiting())));
    const pending = pendingCheck();

    const checked = wait.track(pending.check);
    assert.strictEqual(describeSessionWait(wait.isWaiting()), "Connecting to the server…");
    pending.serverDown();
    pending.serverDown();
    assert.strictEqual(
      describeSessionWait(wait.isWaiting()),
      "Can't reach the server. Reconnecting…",
    );
    pending.answer("signed in");

    assert.strictEqual(await checked, "signed in");
    assert.isFalse(wait.isWaiting());
    assert.deepStrictEqual(seen, [
      "Can't reach the server. Reconnecting…",
      "Connecting to the server…",
    ]);
  });

  it("keeps waiting while any check is still waiting", async () => {
    const wait = makeSessionWait();
    const first = pendingCheck();
    const second = pendingCheck();

    const firstChecked = wait.track(first.check);
    const secondChecked = wait.track(second.check);
    first.serverDown();
    second.serverDown();
    first.answer("signed in");
    await firstChecked;

    assert.isTrue(wait.isWaiting());
    second.answer("signed in");
    await secondChecked;
    assert.isFalse(wait.isWaiting());
  });
});

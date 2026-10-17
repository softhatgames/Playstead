import { describe, expect, it } from "vite-plus/test";

import {
  alternateComposerDispatchAction,
  resolveComposerDispatchMode,
} from "./composerDispatch.ts";

describe("resolveComposerDispatchMode", () => {
  it("starts an ordinary turn while idle, whatever is held", () => {
    expect(
      resolveComposerDispatchMode({
        running: false,
        alternateModifier: false,
        activeTurnDefault: "queue",
      }),
    ).toBe("auto");
    expect(
      resolveComposerDispatchMode({
        running: false,
        alternateModifier: true,
        activeTurnDefault: "queue",
      }),
    ).toBe("auto");
  });

  it("queues while a run is active", () => {
    expect(
      resolveComposerDispatchMode({
        running: true,
        alternateModifier: false,
        activeTurnDefault: "queue",
      }),
    ).toBe("queue");
  });

  it("queues with Mod held too, while queueing is the only follow-up", () => {
    expect(alternateComposerDispatchAction("queue")).toBeUndefined();
    expect(
      resolveComposerDispatchMode({
        running: true,
        alternateModifier: true,
        activeTurnDefault: "queue",
      }),
    ).toBe("queue");
  });
});

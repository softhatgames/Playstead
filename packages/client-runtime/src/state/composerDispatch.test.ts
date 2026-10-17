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
        activeTurnDefault: "steer",
      }),
    ).toBe("auto");
  });

  it("does the follow-up behaviour while a run is active", () => {
    expect(
      resolveComposerDispatchMode({
        running: true,
        alternateModifier: false,
        activeTurnDefault: "queue",
      }),
    ).toBe("queue");
    expect(
      resolveComposerDispatchMode({
        running: true,
        alternateModifier: false,
        activeTurnDefault: "steer",
      }),
    ).toBe("steer");
  });

  it("does the other follow-up with Mod held", () => {
    expect(
      resolveComposerDispatchMode({
        running: true,
        alternateModifier: true,
        activeTurnDefault: "queue",
      }),
    ).toBe("steer");
    expect(
      resolveComposerDispatchMode({
        running: true,
        alternateModifier: true,
        activeTurnDefault: "steer",
      }),
    ).toBe("queue");
    expect(alternateComposerDispatchAction("queue")).toBe("steer");
    expect(alternateComposerDispatchAction("steer")).toBe("queue");
  });
});

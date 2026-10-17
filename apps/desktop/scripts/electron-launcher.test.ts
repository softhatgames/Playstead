import { assert, describe, it } from "@effect/vitest";

import { createElectronEnv } from "./electron-launcher.ts";

describe("electron launcher", () => {
  it("starts Electron as an app, without T3 Code's or the agent's variables", () => {
    const env = createElectronEnv({
      PATH: "/usr/bin",
      HOME: "/Users/person",
      PLAYSTEAD_PORT: "14774",
      PLAYSTEAD_DEV_URL: "http://localhost:5834/",
      ELECTRON_RUN_AS_NODE: "1",
      T3CODE_HOME: "/Users/person/.t3",
      T3CODE_PORT: "3773",
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
    });

    assert.deepStrictEqual(env, {
      PATH: "/usr/bin",
      HOME: "/Users/person",
      PLAYSTEAD_PORT: "14774",
      PLAYSTEAD_DEV_URL: "http://localhost:5834/",
    });
  });
});

import { assert, describe, it } from "@effect/vitest";

import { createDevRunnerEnv } from "./dev-runner.ts";

const shellInsideT3Code = {
  PATH: "/usr/local/bin:/usr/bin",
  HOME: "/Users/person",
  LANG: "bg_BG.UTF-8",
  TERM: "xterm-256color",
  ELECTRON_RUN_AS_NODE: "1",
  T3CODE_HOME: "/Users/person/.t3",
  T3CODE_PORT: "3773",
  T3CODE_CLI_PATH: "/Applications/T3 Code.app/cli",
  CLAUDECODE: "1",
  CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
  ANTHROPIC_API_KEY: "sk-ant-not-meant-for-playstead",
  VITE_DEV_SERVER_URL: "http://localhost:5733",
  PORT: "5733",
};

describe("dev runner environment", () => {
  it("starts children with only the variables they need, and no T3 Code variable", () => {
    const env = createDevRunnerEnv({
      baseEnv: shellInsideT3Code,
      serverPort: 14774,
      webPort: 5834,
      playsteadHome: "/work/playstead/.playstead",
    });

    assert.deepStrictEqual(env, {
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/Users/person",
      LANG: "bg_BG.UTF-8",
      TERM: "xterm-256color",
      PLAYSTEAD_PORT: "14774",
      PLAYSTEAD_WEB_PORT: "5834",
      PLAYSTEAD_DEV_URL: "http://localhost:5834/",
      PLAYSTEAD_HOME: "/work/playstead/.playstead",
    });
  });

  it("keeps Windows variables in the case Windows gave them", () => {
    const env = createDevRunnerEnv({
      baseEnv: {
        Path: "C:\\Windows\\system32",
        SystemRoot: "C:\\Windows",
        ComSpec: "C:\\Windows\\system32\\cmd.exe",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        USERPROFILE: "C:\\Users\\person",
        T3CODE_HOME: "C:\\Users\\person\\.t3",
      },
      serverPort: 14773,
      webPort: 5833,
      playsteadHome: undefined,
    });

    assert.deepStrictEqual(env, {
      Path: "C:\\Windows\\system32",
      SystemRoot: "C:\\Windows",
      ComSpec: "C:\\Windows\\system32\\cmd.exe",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      USERPROFILE: "C:\\Users\\person",
      PLAYSTEAD_PORT: "14773",
      PLAYSTEAD_WEB_PORT: "5833",
      PLAYSTEAD_DEV_URL: "http://localhost:5833/",
    });
  });
});

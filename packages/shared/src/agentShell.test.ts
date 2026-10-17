import { assert, describe, it } from "@effect/vitest";

import { withoutAgentShellVariables } from "./agentShell.ts";

describe("withoutAgentShellVariables", () => {
  it("drops T3 Code's and the coding agent's variables, in any case, and keeps the rest", () => {
    assert.deepStrictEqual(
      withoutAgentShellVariables({
        PATH: "/usr/bin",
        HOME: "/Users/person",
        PLAYSTEAD_PORT: "14774",
        UNSET: undefined,
        ELECTRON_RUN_AS_NODE: "1",
        electron_run_as_node: "1",
        T3CODE_HOME: "/Users/person/.t3",
        t3code_cli_path: "/Applications/T3 Code.app",
        CLAUDECODE: "1",
        ClaudeCode: "1",
        CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
        Claude_Code_Session_Id: "session",
      }),
      { PATH: "/usr/bin", HOME: "/Users/person", PLAYSTEAD_PORT: "14774" },
    );
  });
});

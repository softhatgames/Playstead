/**
 * A variable a coding agent's shell carries that must not reach a program
 * Playstead starts from it: T3 Code's `T3CODE_*`, Claude Code's `CLAUDECODE`
 * and `CLAUDE_CODE_*`, and `ELECTRON_RUN_AS_NODE`, which starts Electron as
 * plain Node. Windows variable names are case-insensitive, so this is too.
 */
const isAgentShellVariable = (name: string) => {
  const upper = name.toUpperCase();
  return (
    upper === "ELECTRON_RUN_AS_NODE" ||
    upper === "CLAUDECODE" ||
    upper.startsWith("T3CODE_") ||
    upper.startsWith("CLAUDE_CODE_")
  );
};

/** The environment without the agent shell's variables or unset entries. */
export const withoutAgentShellVariables = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !isAgentShellVariable(name)) kept[name] = value;
  }
  return kept;
};

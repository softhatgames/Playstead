// @effect-diagnostics preferSchemaOverJson:off -- The fakes' sources are written as JavaScript text.
import { writeFakeCli } from "./fakeCli.ts";

/**
 * A fake `codex`. `codex app-server` speaks JSON-RPC, one message per line on
 * stdio, and answers `initialize` with a user agent that carries the version,
 * which is where T3 Code reads Codex's version (`CodexProvider.ts` at
 * 2577baf). Any other request gets "method not found". It exits when stdin
 * closes.
 */
const fakeCodexSource = (version: string) => `
import { createInterface } from "node:readline";
if (process.argv[2] !== "app-server") {
  process.stderr.write("fake codex only runs app-server\\n");
  process.exit(2);
}
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: ${JSON.stringify(`playstead/${version} (fake codex)`)} } });
    return;
  }
  send({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
});
lines.on("close", () => process.exit(0));
`;

/** A fake `claude` that answers `--version` the way Claude Code prints it. */
const fakeClaudeSource = (version: string) => `
if (process.argv.includes("--version")) {
  process.stdout.write(${JSON.stringify(`${version} (Claude Code)\n`)});
  process.exit(0);
}
process.stderr.write("fake claude only answers --version\\n");
process.exit(2);
`;

export const writeFakeCodex = (options: { readonly directory: string; readonly version: string }) =>
  writeFakeCli({
    directory: options.directory,
    name: "codex",
    source: fakeCodexSource(options.version),
  });

export const writeFakeClaude = (options: {
  readonly directory: string;
  readonly version: string;
}) =>
  writeFakeCli({
    directory: options.directory,
    name: "claude",
    source: fakeClaudeSource(options.version),
  });

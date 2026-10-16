// @effect-diagnostics preferSchemaOverJson:off -- The fakes' sources are written as JavaScript text.
import { writeFakeCli } from "./fakeCli.ts";

/** The account `account/read` answers with, as Codex's schema has it; `null` is signed out. */
export type FakeCodexAccount =
  | { readonly type: "apiKey" }
  | { readonly type: "chatgpt"; readonly email: string; readonly planType: string };

export interface FakeCodexModel {
  readonly model: string;
  readonly displayName: string;
  readonly isDefault?: boolean;
}

const FAKE_CODEX_MODEL_PAGE_SIZE = 2;

/**
 * A fake `codex`. `codex app-server` speaks JSON-RPC, one message per line on
 * stdio. The fake answers `initialize` with a user agent that carries the
 * version, which is where T3 Code reads Codex's version (`CodexProvider.ts` at
 * 2577baf), `account/read` with the account (signed out: none, with OpenAI
 * auth required), and `model/list` two models a page, following `cursor` as
 * Codex pages its list. Any other request gets "method not found". It exits
 * when stdin closes.
 */
const fakeCodexSource = (input: {
  readonly version: string;
  readonly account: FakeCodexAccount | null;
  readonly models: ReadonlyArray<FakeCodexModel>;
}) => `
import { createInterface } from "node:readline";
if (process.argv[2] !== "app-server") {
  process.stderr.write("fake codex only runs app-server\\n");
  process.exit(2);
}
const userAgent = ${JSON.stringify(`playstead/${input.version} (fake codex)`)};
const account = ${JSON.stringify(input.account)};
const models = ${JSON.stringify(
  input.models.map((model) => ({
    id: model.model,
    model: model.model,
    displayName: model.displayName,
    description: model.displayName,
    hidden: false,
    isDefault: model.isDefault ?? false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [],
  })),
)};
const answer = (method, params) => {
  if (method === "initialize") {
    return { userAgent, codexHome: "/fake/.codex", platformFamily: "unix", platformOs: "macos" };
  }
  if (method === "account/read") return { account, requiresOpenaiAuth: true };
  if (method === "model/list") {
    const start = Number(params?.cursor ?? 0);
    const end = start + ${FAKE_CODEX_MODEL_PAGE_SIZE};
    return { data: models.slice(start, end), nextCursor: end < models.length ? String(end) : null };
  }
  return undefined;
};
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const result = answer(message.method, message.params);
  if (result !== undefined) {
    send({ id: message.id, result });
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

/** A fake `codex`, signed in with an API key and offering one model unless told otherwise. */
export const writeFakeCodex = (options: {
  readonly directory: string;
  readonly version: string;
  readonly account?: FakeCodexAccount | null;
  readonly models?: ReadonlyArray<FakeCodexModel>;
}) =>
  writeFakeCli({
    directory: options.directory,
    name: "codex",
    source: fakeCodexSource({
      version: options.version,
      account: options.account === undefined ? { type: "apiKey" } : options.account,
      models: options.models ?? [{ model: "gpt-fake", displayName: "GPT-Fake", isDefault: true }],
    }),
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

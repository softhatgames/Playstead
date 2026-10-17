// @effect-diagnostics preferSchemaOverJson:off -- The fakes' sources are written as JavaScript text.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { writeFakeCli } from "./fakeCli.ts";

/** The account `account/read` answers with, as Codex's schema has it; `null` is signed out. */
export type FakeCodexAccount =
  | { readonly type: "apiKey" }
  | { readonly type: "chatgpt"; readonly email: string; readonly planType: string };

export interface FakeCodexModel {
  readonly model: string;
  readonly displayName: string;
  readonly isDefault?: boolean;
  /** `medium` unless given. */
  readonly defaultReasoningEffort?: string;
  /** None unless given. */
  readonly supportedReasoningEfforts?: ReadonlyArray<string>;
  readonly serviceTiers?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly description: string;
  }>;
  /** The older form of `serviceTiers`: ids only. */
  readonly additionalSpeedTiers?: ReadonlyArray<string>;
  readonly defaultServiceTier?: string;
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
    defaultReasoningEffort: model.defaultReasoningEffort ?? "medium",
    supportedReasoningEfforts: (model.supportedReasoningEfforts ?? []).map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningEffort,
    })),
    ...(model.serviceTiers === undefined ? {} : { serviceTiers: model.serviceTiers }),
    ...(model.additionalSpeedTiers === undefined
      ? {}
      : { additionalSpeedTiers: model.additionalSpeedTiers }),
    ...(model.defaultServiceTier === undefined
      ? {}
      : { defaultServiceTier: model.defaultServiceTier }),
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

/**
 * A fake `claude`. It answers `--version` the way Claude Code prints it.
 * Started by the Claude Agent SDK, it reads the SDK's control requests, one
 * JSON message per line on stdin, and answers `initialize` with the account a
 * signed-in or signed-out Claude Code reports, after T3 Code's
 * `ClaudeCapabilitiesProbe.fixture.mjs` (`apps/server/src/provider/testing/`
 * at 2577baf). It exits when stdin closes.
 */
const fakeClaudeSource = (version: string, signedIn: boolean) => `
import { createInterface } from "node:readline";
if (process.argv.includes("--version")) {
  process.stdout.write(${JSON.stringify(`${version} (Claude Code)\n`)});
  process.exit(0);
}
const account = ${JSON.stringify(
  signedIn
    ? { email: "dev@example.com", subscriptionType: "max", tokenSource: "claude.ai" }
    : { tokenSource: "none", apiKeySource: "none" },
)};
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type !== "control_request" || message.request?.subtype !== "initialize") return;
  process.stdout.write(JSON.stringify({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: message.request_id,
      response: { commands: [], agents: [], output_style: "default", available_output_styles: ["default"], models: [], account },
    },
  }) + "\\n");
});
// The SDK may close stdin without waiting for the process, so stay alive only until then.
const keepAlive = setInterval(() => {}, 1_000);
lines.on("close", () => {
  clearInterval(keepAlive);
  process.exit(0);
});
`;

/** A fake `codex`, signed in with an API key and offering one model unless told otherwise. */
export const writeFakeCodex = (options: {
  readonly directory: string;
  readonly version: string;
  readonly account?: FakeCodexAccount | null;
  readonly models?: ReadonlyArray<FakeCodexModel>;
  /** A file each start appends its environment to, as one JSON line. */
  readonly environmentLog?: string;
}) =>
  writeFakeCli({
    directory: options.directory,
    name: "codex",
    ...(options.environmentLog === undefined ? {} : { environmentLog: options.environmentLog }),
    source: fakeCodexSource({
      version: options.version,
      account: options.account === undefined ? { type: "apiKey" } : options.account,
      models: options.models ?? [{ model: "gpt-fake", displayName: "GPT-Fake", isDefault: true }],
    }),
  });

/**
 * Writes a fake `claude` and returns its launcher. Beside it goes the npm
 * package entry `node_modules/@anthropic-ai/claude-code/cli.js`, which is what
 * the Agent SDK runs on Windows instead of the `.cmd` shim.
 */
export const writeFakeClaude = Effect.fn("writeFakeClaude")(function* (options: {
  readonly directory: string;
  readonly version: string;
  /** Whether Claude Code reports a signed-in account; signed in unless `false`. */
  readonly signedIn?: boolean;
  /** A file each start appends its environment to, as one JSON line. */
  readonly environmentLog?: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const launcher = yield* writeFakeCli({
    directory: options.directory,
    name: "claude",
    source: fakeClaudeSource(options.version, options.signedIn ?? true),
    ...(options.environmentLog === undefined ? {} : { environmentLog: options.environmentLog }),
  });
  const packageDirectory = path.join(
    options.directory,
    "node_modules",
    "@anthropic-ai",
    "claude-code",
  );
  yield* fs.makeDirectory(packageDirectory, { recursive: true });
  yield* fs.writeFileString(path.join(packageDirectory, "package.json"), '{ "type": "module" }\n');
  yield* fs.writeFileString(
    path.join(packageDirectory, "cli.js"),
    'import "../../../claude-stub.mjs";\n',
  );
  return launcher;
});

import {
  type AccountInfo,
  query as claudeQuery,
  type Options as ClaudeQueryOptions,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ServerProviderAuth, ServerProviderModel } from "@playstead/contracts/server";
import type { ProviderProbeResult } from "@playstead/provider-core/server/driver";
import {
  DEFAULT_TIMEOUT_MS,
  isCommandMissingCause,
  parseGenericCliVersion,
  spawnAndCollect,
} from "@playstead/provider-core/server/snapshotProbe";
import { type ProcessEnvironment, resolveSpawnCommand } from "@playstead/shared/shell";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

import { resolveClaudeModelsForVersion } from "./ClaudeModelCatalog.ts";
import { resolveClaudeSdkExecutablePath } from "./Drivers/ClaudeExecutable.ts";

export interface ClaudeProbeInput {
  readonly binaryPath: string;
  readonly environment: ProcessEnvironment;
  readonly platform: NodeJS.Platform;
  readonly cwd: string;
}

/** What a Claude check finds: the probe, and the models the found version runs. */
export interface ClaudeStatus {
  readonly probe: ProviderProbeResult;
  readonly models: ReadonlyArray<ServerProviderModel>;
}

/**
 * Amazon Bedrock and other external backends start far slower than a
 * first-party sign-in, so T3 Code waits this long for the account.
 */
const ACCOUNT_PROBE_TIMEOUT_MS = 25_000;

/** Claude Code reads this file's MCP servers itself and refuses `--strict-mcp-config` beside it. */
const managedMcpConfigPath = (platform: NodeJS.Platform) =>
  platform === "darwin"
    ? "/Library/Application Support/ClaudeCode/managed-mcp.json"
    : platform === "win32"
      ? "C:\\Program Files\\ClaudeCode\\managed-mcp.json"
      : "/etc/claude-code/managed-mcp.json";

/**
 * The account Claude Code reports when the Agent SDK starts it, as T3 Code's
 * `probeClaudeCapabilities` (`apps/server/src/provider/ClaudeProvider.ts` at
 * 2577baf). The prompt never yields, so Claude Code answers the SDK's
 * `initialize` and no request reaches Anthropic. The person's own `claude`
 * runs, never one bundled with the SDK, with their settings but no hooks
 * and no MCP servers. `undefined` when the account could not be read.
 */
const probeClaudeAccount = (input: ClaudeProbeInput) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const executablePath = yield* resolveClaudeSdkExecutablePath(input.binaryPath, {
      platform: input.platform,
      env: input.environment,
    });
    const managedMcpConfig = yield* fileSystem
      .exists(managedMcpConfigPath(input.platform))
      .pipe(Effect.orElseSucceed(() => false));
    const abort = yield* Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (controller) => Effect.sync(() => controller.abort()),
    );
    const options: ClaudeQueryOptions = {
      pathToClaudeCodeExecutable: executablePath,
      abortController: abort,
      persistSession: false,
      settingSources: ["user", "project", "local"],
      settings: { disableAllHooks: true },
      allowedTools: [],
      mcpServers: {},
      ...(managedMcpConfig ? {} : { strictMcpConfig: true }),
      env: {
        ...input.environment,
        ENABLE_CLAUDEAI_MCP_SERVERS: "false",
        FORCE_CODE_TERMINAL: undefined,
        CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
        CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
      },
      cwd: input.cwd,
      stderr: () => {},
    };
    const initialization = yield* Effect.tryPromise(() =>
      claudeQuery({
        // oxlint-disable-next-line require-yield -- It never yields: no prompt reaches the API.
        prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
          await new Promise<void>((resolve) =>
            abort.signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        })(),
        options,
      }).initializationResult(),
    );
    return initialization.account;
  }).pipe(
    Effect.scoped,
    Effect.timeout(Duration.millis(ACCOUNT_PROBE_TIMEOUT_MS)),
    Effect.tapError((error) =>
      Effect.logWarning("Could not read Claude's account.").pipe(
        Effect.annotateLogs({ errorTag: error._tag }),
      ),
    ),
    Effect.option,
    Effect.map(Option.getOrUndefined),
  );

/**
 * A completed probe only proves Claude Code started. As in T3 Code's
 * `claudeAuthStatus`, `tokenSource: "none"` with no key, e-mail or plan is the
 * one answer that proves no one is signed in; an external backend such as
 * Amazon Bedrock signs in outside Claude Code.
 */
function isSignedIn(account: AccountInfo): boolean {
  if (account.apiProvider !== undefined && account.apiProvider !== "firstParty") return true;
  if (account.tokenSource !== "none") return true;
  const hasApiKey = account.apiKeySource !== undefined && account.apiKeySource !== "none";
  return hasApiKey || Boolean(account.email) || Boolean(account.subscriptionType);
}

const PLAN_NAMES: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  max: "Max",
  maxplan: "Max",
  max5: "Max 5x",
  max5x: "Max 5x",
  max20: "Max 20x",
  max20x: "Max 20x",
  team: "Team",
  enterprise: "Enterprise",
};

const titleCase = (value: string) =>
  value
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

/**
 * How the account is named on the card, after T3 Code's `claudeAuthMetadata`:
 * "Claude API Key", "Claude Max Subscription", "Amazon Bedrock".
 */
function accountKind(account: AccountInfo): Pick<ServerProviderAuth, "type" | "label"> {
  const tokenSource = account.tokenSource?.toLowerCase().replace(/[\s_-]+/g, "");
  if (
    tokenSource === "apikey" ||
    tokenSource === "anthropicapikey" ||
    tokenSource === "anthropicauthtoken"
  ) {
    return { type: "apiKey", label: "Claude API Key" };
  }
  const plan = account.subscriptionType?.trim();
  if (plan) {
    const key = plan
      .toLowerCase()
      .replace(/[\s_-]+/g, "")
      .replace(/^claude/, "")
      .replace(/subscription$/, "");
    return { type: plan, label: `Claude ${PLAN_NAMES[key] ?? titleCase(plan)} Subscription` };
  }
  if (account.apiProvider === "bedrock") return { type: "bedrock", label: "Amazon Bedrock" };
  return {};
}

/**
 * Claude's status, as T3 Code's `checkClaudeProviderStatus`
 * (`apps/server/src/provider/ClaudeProvider.ts` at 2577baf): `claude
 * --version` gives the version and with it the models; then the Agent SDK's
 * account information says whether Claude is signed in.
 */
export const checkClaudeProviderStatus = Effect.fn("checkClaudeProviderStatus")(function* (
  input: ClaudeProbeInput,
): Effect.fn.Return<
  ClaudeStatus,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> {
  const target = { platform: input.platform, env: input.environment };
  const spawnCommand = yield* resolveSpawnCommand(input.binaryPath, ["--version"], target);
  const versionProbe = yield* spawnAndCollect(
    input.binaryPath,
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      cwd: input.cwd,
      env: input.environment,
      extendEnv: false,
      shell: spawnCommand.shell,
    }),
    input.platform,
  ).pipe(Effect.timeoutOption(Duration.millis(DEFAULT_TIMEOUT_MS)), Effect.result);

  if (Result.isFailure(versionProbe)) {
    const missing = isCommandMissingCause(versionProbe.failure);
    yield* Effect.logWarning("Claude Agent CLI health check failed.").pipe(
      Effect.annotateLogs({ errorTag: versionProbe.failure._tag }),
    );
    return {
      models: [],
      probe: {
        installed: !missing,
        version: null,
        status: "error",
        message: missing
          ? "Claude Agent CLI (`claude`) was not found on PATH."
          : "Failed to execute Claude Agent CLI health check.",
      },
    };
  }
  if (Option.isNone(versionProbe.success)) {
    return {
      models: [],
      probe: {
        installed: true,
        version: null,
        status: "error",
        message:
          "Claude Agent CLI is installed but failed to run. Timed out while running command.",
      },
    };
  }
  const result = versionProbe.success.value;
  const version = parseGenericCliVersion(`${result.stdout}\n${result.stderr}`);
  if (result.code !== 0) {
    return {
      models: [],
      probe: {
        installed: true,
        version,
        status: "error",
        message: "Claude Agent CLI is installed but failed to run.",
      },
    };
  }

  const models = resolveClaudeModelsForVersion(version);
  const account = yield* probeClaudeAccount(input);
  if (account === undefined) {
    return {
      models,
      probe: {
        installed: true,
        version,
        status: "warning",
        message: "Could not verify Claude authentication status from initialization result.",
      },
    };
  }
  if (!isSignedIn(account)) {
    return {
      models,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Claude Code is not authenticated. Run `claude auth login` and try again.",
      },
    };
  }
  return {
    models,
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "authenticated", ...accountKind(account) },
    },
  };
});

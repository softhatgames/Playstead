import type { ServerProviderAuth, ServerProviderModel } from "@playstead/contracts/server";
import * as CodexClient from "@playstead/effect-codex-app-server/client";
import {
  type CodexAppServerError,
  CodexAppServerSpawnError,
} from "@playstead/effect-codex-app-server/errors";
import type * as CodexSchema from "@playstead/effect-codex-app-server/schema";
import type { ProviderProbeResult } from "@playstead/provider-core/server/driver";
import {
  AUTH_PROBE_TIMEOUT_MS,
  isWindowsCommandNotFound,
} from "@playstead/provider-core/server/snapshotProbe";
import { identity } from "@playstead/shared/identity";
import { type ProcessEnvironment, resolveSpawnCommand } from "@playstead/shared/shell";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import type * as Scope from "effect/Scope";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import packageJson from "../../package.json" with { type: "json" };

/**
 * Codex's status, read over `codex app-server` through Playstead's Codex
 * app-server client, as T3 Code reads it
 * (`apps/server/src/provider/CodexProvider.ts` at 2577baf): the version from
 * `initialize`'s user agent, sign-in from `account/read`, and the models from
 * `model/list`. Skills, rate limits and the managed runtime are absent.
 */

export interface CodexProbeInput {
  readonly binaryPath: string;
  readonly environment: ProcessEnvironment;
  readonly platform: NodeJS.Platform;
  readonly cwd: string;
}

/** `codexAppServerEnvironment` at 2577baf, naming Playstead as the originator. */
const codexAppServerEnvironment = (environment: ProcessEnvironment) => ({
  CODEX_INTERNAL_ORIGINATOR_OVERRIDE: identity.productName.production,
  ...environment,
});

/** `buildCodexInitializeParams`'s client info at 2577baf. */
export const codexClientInfo: CodexSchema.InitializeParams["clientInfo"] = {
  name: identity.urlScheme.production,
  title: identity.productName.production,
  version: packageJson.version,
};

const initializeParams: CodexSchema.InitializeParams = {
  clientInfo: codexClientInfo,
  capabilities: { experimentalApi: true },
};

/**
 * Spawns `codex app-server` in the current scope with the server's
 * environment, through `resolveSpawnCommand` so a `.cmd` on Windows runs.
 */
export const spawnCodexAppServer = Effect.fn("spawnCodexAppServer")(function* (
  input: CodexProbeInput,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const environment = codexAppServerEnvironment(input.environment);
  const spawnCommand = yield* resolveSpawnCommand(input.binaryPath, ["app-server"], {
    platform: input.platform,
    env: environment,
  });
  return yield* spawner
    .spawn(
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        cwd: input.cwd,
        env: environment,
        extendEnv: false,
        shell: spawnCommand.shell,
        forceKillAfter: "2 seconds",
      }),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new CodexAppServerSpawnError({ command: `${input.binaryPath} app-server`, cause }),
      ),
    );
});

/** Starts `codex app-server` in the current scope and returns the client, initialized. */
const startCodexAppServer = Effect.fn("startCodexAppServer")(function* (input: CodexProbeInput) {
  const client = yield* CodexClient.fromChildProcess(yield* spawnCodexAppServer(input));
  const initialize = yield* client.request("initialize", initializeParams);
  yield* client.notify("initialized", undefined);
  return { client, initialize };
});

/** `codexPlanLabel` at 2577baf. */
const codexPlanLabel = (planType: string): string | undefined => {
  switch (planType) {
    case "free":
      return "ChatGPT Free Subscription";
    case "go":
      return "ChatGPT Go Subscription";
    case "plus":
      return "ChatGPT Plus Subscription";
    case "pro":
      return "ChatGPT Pro 20x Subscription";
    case "prolite":
      return "ChatGPT Pro 5x Subscription";
    case "promax":
      return "ChatGPT Pro Max Subscription";
    case "team":
      return "ChatGPT Team Subscription";
    case "business":
    case "self_serve_business_prolite":
    case "self_serve_business_usage_based":
      return "ChatGPT Business Subscription";
    case "enterprise":
    case "ent26":
    case "enterprise_cbp_automation":
    case "enterprise_cbp_usage_based":
      return "ChatGPT Enterprise Subscription";
    case "edu":
    case "edu_plus":
    case "edu_pro":
      return "ChatGPT Edu Subscription";
    case "unknown":
      return "ChatGPT Subscription";
    default:
      return undefined;
  }
};

/** `accountProbeStatus`'s auth at 2577baf: the kind of account, its label and, for ChatGPT, its e-mail. */
const codexAuth = (account: CodexSchema.V2Account): ServerProviderAuth => {
  switch (account.type) {
    case "apiKey":
      return { status: "authenticated", type: "apiKey", label: "OpenAI API Key" };
    case "amazonBedrock":
      return { status: "authenticated", type: "amazonBedrock", label: "Amazon Bedrock" };
    case "chatgpt": {
      const label = codexPlanLabel(account.planType);
      const email = account.email?.trim();
      return {
        status: "authenticated",
        type: "chatgpt",
        ...(label === undefined ? {} : { label }),
        ...(email ? { email } : {}),
      };
    }
  }
};

/** `formatCodexModelName` at 2577baf: `gpt-6-astra` reads as `GPT-6-Astra`. */
const formatCodexModelName = (name: string) =>
  name
    .replace(/^gpt/i, "GPT")
    .replace(/-([a-z])/g, (_, letter: string) => `-${letter.toUpperCase()}`);

/** Every page of `model/list`, as `requestAllCodexModels` at 2577baf. Codex's own default stays the default. */
const listCodexModels = Effect.fn("listCodexModels")(function* (
  client: CodexClient.CodexAppServerClient["Service"],
) {
  const models: Array<ServerProviderModel> = [];
  let cursor: string | null | undefined;
  do {
    const page = yield* client.request("model/list", cursor ? { cursor } : {});
    for (const model of page.data) {
      models.push({
        slug: model.model,
        name: formatCodexModelName(model.displayName),
        ...(model.isDefault ? { isDefault: true } : {}),
      });
    }
    cursor = page.nextCursor;
  } while (cursor);
  return models;
});

const probeCodexAppServer = Effect.fn("probeCodexAppServer")(function* (
  input: CodexProbeInput,
): Effect.fn.Return<
  CodexStatus,
  CodexAppServerError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Scope.Scope
> {
  const { client, initialize } = yield* startCodexAppServer(input);
  const version = /\/([^\s]+)/.exec(initialize.userAgent)?.[1] ?? null;
  const { account, requiresOpenaiAuth } = yield* client.request("account/read", {});
  if ((account === undefined || account === null) && requiresOpenaiAuth) {
    return {
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Codex CLI is not authenticated. Run `codex login` and try again.",
      },
      models: [],
    };
  }
  return {
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: account === undefined || account === null ? { status: "unknown" } : codexAuth(account),
    },
    models: yield* listCodexModels(client),
  };
});

const notFoundMessage = (binaryPath: string) =>
  `Could not start Codex CLI (\`${binaryPath}\`). Check Settings → Providers → Codex → Binary path on the server.` +
  (binaryPath === "codex"
    ? " Installing ChatGPT or Codex desktop may not add codex to PATH."
    : " Make sure the configured executable exists and can be run.");

/** What a Codex check finds: the probe, and the models Codex lists. */
export interface CodexStatus {
  readonly probe: ProviderProbeResult;
  readonly models: ReadonlyArray<ServerProviderModel>;
}

/** `checkCodexProviderStatus` at 2577baf. */
export const checkCodexProviderStatus = Effect.fn("checkCodexProviderStatus")(function* (
  input: CodexProbeInput,
): Effect.fn.Return<
  CodexStatus,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> {
  const result = yield* probeCodexAppServer(input).pipe(
    Effect.scoped,
    Effect.timeoutOption(Duration.millis(AUTH_PROBE_TIMEOUT_MS)),
    Effect.result,
  );
  if (Result.isFailure(result)) {
    const error = result.failure;
    const notFound =
      error._tag === "CodexAppServerSpawnError" ||
      (error._tag === "CodexAppServerProcessExitedError" &&
        isWindowsCommandNotFound(input.platform, error.code, error.stderr));
    return {
      probe: notFound
        ? {
            installed: false,
            version: null,
            status: "error",
            message: notFoundMessage(input.binaryPath),
          }
        : {
            installed: true,
            version: null,
            status: "error",
            message: `Codex app-server provider probe failed: ${error.message}.`,
          },
      models: [],
    };
  }
  if (Option.isNone(result.success)) {
    return {
      probe: {
        installed: true,
        version: null,
        status: "error",
        message: "Timed out while checking Codex app-server provider status.",
      },
      models: [],
    };
  }
  return result.success.value;
});

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
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

export interface ClaudeProbeInput {
  readonly binaryPath: string;
  readonly environment: ProcessEnvironment;
  readonly platform: NodeJS.Platform;
  readonly cwd: string;
}

/**
 * Claude's status from `claude --version`, as T3 Code's
 * `checkClaudeProviderStatus` (`apps/server/src/provider/ClaudeProvider.ts` at
 * 2577baf) starts it. Its next step, the Agent SDK's account information for
 * sign-in, and the model catalog come with the Claude sign-in ticket, after
 * the version check below succeeds.
 */
export const checkClaudeProviderStatus = Effect.fn("checkClaudeProviderStatus")(function* (
  input: ClaudeProbeInput,
): Effect.fn.Return<
  ProviderProbeResult,
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
      installed: !missing,
      version: null,
      status: "error",
      message: missing
        ? "Claude Agent CLI (`claude`) was not found on PATH."
        : "Failed to execute Claude Agent CLI health check.",
    };
  }
  if (Option.isNone(versionProbe.success)) {
    return {
      installed: true,
      version: null,
      status: "error",
      message: "Claude Agent CLI is installed but failed to run. Timed out while running command.",
    };
  }
  const result = versionProbe.success.value;
  const version = parseGenericCliVersion(`${result.stdout}\n${result.stderr}`);
  if (result.code !== 0) {
    return {
      installed: true,
      version,
      status: "error",
      message: "Claude Agent CLI is installed but failed to run.",
    };
  }
  return { installed: true, version, status: "ready" };
});

// @effect-diagnostics preferSchemaOverJson:off -- One fixed JSON-RPC request line, written once.
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
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import packageJson from "../../package.json" with { type: "json" };

/**
 * Codex's status, read over `codex app-server` as T3 Code reads it
 * (`apps/server/src/provider/CodexProvider.ts` at 2577baf). Codex has no
 * version probe: the version is in the user agent `initialize` answers with.
 *
 * This ticket needs only `initialize`, so it writes that one JSON-RPC line
 * itself. The Codex app-server client replaces this with its typed client and
 * adds `account/read` and `model/list` for sign-in and models.
 */

class CodexAppServerSpawnError extends Schema.TaggedError<CodexAppServerSpawnError>()(
  "CodexAppServerSpawnError",
  { command: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Could not start ${this.command}: ${this.detail}`;
  }
}

class CodexAppServerProbeError extends Schema.TaggedError<CodexAppServerProbeError>()(
  "CodexAppServerProbeError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

const INITIALIZE_REQUEST_ID = 1;

/** `codexAppServerEnvironment` at 2577baf, naming Playstead as the originator. */
const codexAppServerEnvironment = (environment: ProcessEnvironment) => ({
  CODEX_INTERNAL_ORIGINATOR_OVERRIDE: identity.productName.production,
  ...environment,
});

const initializeLine = `${JSON.stringify({
  id: INITIALIZE_REQUEST_ID,
  method: "initialize",
  params: {
    clientInfo: {
      name: identity.urlScheme.production,
      title: identity.productName.production,
      version: packageJson.version,
    },
    capabilities: { experimentalApi: true },
  },
})}\n`;

const InitializeResponse = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.Literal(INITIALIZE_REQUEST_ID),
    result: Schema.optionalKey(Schema.Struct({ userAgent: Schema.String })),
    error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
  }),
);
const decodeInitializeResponse = Schema.decodeUnknownOption(InitializeResponse);

export interface CodexProbeInput {
  readonly binaryPath: string;
  readonly environment: ProcessEnvironment;
  readonly platform: NodeJS.Platform;
  readonly cwd: string;
}

class CodexCommandNotFound extends Schema.TaggedError<CodexCommandNotFound>()(
  "CodexCommandNotFound",
  {},
) {}

/** Starts `codex app-server`, sends `initialize`, and reads the version from the user agent. */
const probeCodexAppServer = Effect.fn("probeCodexAppServer")(function* (input: CodexProbeInput) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const environment = codexAppServerEnvironment(input.environment);
  const target = { platform: input.platform, env: environment };
  const spawnCommand = yield* resolveSpawnCommand(input.binaryPath, ["app-server"], target);
  const child = yield* spawner
    .spawn(
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        cwd: input.cwd,
        env: environment,
        extendEnv: false,
        shell: spawnCommand.shell,
        forceKillAfter: "2 seconds",
        stdin: { stream: Stream.make(new TextEncoder().encode(initializeLine)), endOnDone: false },
      }),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new CodexAppServerSpawnError({
            command: `${input.binaryPath} app-server`,
            detail: cause.message,
          }),
      ),
    );
  const stderr = yield* child.stderr.pipe(
    Stream.decodeText(),
    Stream.mkString,
    Effect.orElseSucceed(() => ""),
    Effect.forkScoped,
  );
  const response = yield* child.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filterMap((line) => Result.fromOption(decodeInitializeResponse(line), () => undefined)),
    Stream.runHead,
    Effect.mapError((cause) => new CodexAppServerProbeError({ detail: cause.message })),
  );
  if (Option.isNone(response)) {
    // stdout closed without an answer: the process ended.
    const code = yield* child.exitCode.pipe(
      Effect.map(Number),
      Effect.orElseSucceed(() => null),
    );
    const errorOutput = yield* Fiber.join(stderr);
    if (isWindowsCommandNotFound(input.platform, code, errorOutput)) {
      return yield* new CodexCommandNotFound();
    }
    return yield* new CodexAppServerProbeError({
      detail: `codex app-server exited (code ${code ?? "unknown"}) before answering initialize`,
    });
  }
  if (response.value.result === undefined) {
    return yield* new CodexAppServerProbeError({
      detail: `initialize failed: ${response.value.error?.message ?? "no result"}`,
    });
  }
  return { version: /\/([^\s]+)/.exec(response.value.result.userAgent)?.[1] ?? null };
});

const notFoundMessage = (binaryPath: string) =>
  `Could not start Codex CLI (\`${binaryPath}\`). Check Settings → Providers → Codex → Binary path on the server.` +
  (binaryPath === "codex"
    ? " Installing ChatGPT or Codex desktop may not add codex to PATH."
    : " Make sure the configured executable exists and can be run.");

/** `checkCodexProviderStatus` at 2577baf, without sign-in and models. */
export const checkCodexProviderStatus = Effect.fn("checkCodexProviderStatus")(function* (
  input: CodexProbeInput,
): Effect.fn.Return<
  ProviderProbeResult,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> {
  const probe = yield* probeCodexAppServer(input).pipe(
    Effect.scoped,
    Effect.timeoutOption(Duration.millis(AUTH_PROBE_TIMEOUT_MS)),
    Effect.result,
  );
  if (Result.isFailure(probe)) {
    const error = probe.failure;
    const installed = error._tag === "CodexAppServerProbeError";
    return {
      installed,
      version: null,
      status: "error",
      message: installed
        ? `Codex app-server provider probe failed: ${error.message}.`
        : notFoundMessage(input.binaryPath),
    };
  }
  if (Option.isNone(probe.success)) {
    return {
      installed: true,
      version: null,
      status: "error",
      message: "Timed out while checking Codex app-server provider status.",
    };
  }
  return { installed: true, version: probe.success.value.version, status: "ready" };
});

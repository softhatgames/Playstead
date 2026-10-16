import type { ProviderDriverKind, ProviderInstanceId } from "@playstead/contracts/providerInstance";
import type { ServerProvider } from "@playstead/contracts/server";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { ChildProcess } from "effect/process";
import { ChildProcessSpawner } from "effect/process";

import type { ProviderProbeResult } from "./driver.ts";

/**
 * The helpers drivers use to check a provider, following T3 Code's
 * `packages/provider-core/src/server/snapshotProbe.ts` at 2577baf.
 */

export const DEFAULT_TIMEOUT_MS = 4_000;
export const AUTH_PROBE_TIMEOUT_MS = 10_000;

/**
 * cmd.exe's "not recognized" message in the languages T3 Code lists, plus
 * Russian, since the founder's Windows laptop has a Cyrillic locale. cmd.exe
 * writes in the console's code page, which is not always UTF-8, so exit code
 * 9009 is the check that holds in every locale; the messages are a fallback.
 */
const WINDOWS_COMMAND_NOT_FOUND_PATTERNS = [
  /is not recognized as an internal or external command/i,
  /n.o . reconhecido como um comando interno/i,
  /non . riconosciuto come comando interno o esterno/i,
  /n.est pas reconnu en tant que commande interne/i,
  /no se reconoce como un comando interno o externo/i,
  /wird nicht als interner oder externer befehl/i,
  /не является внутренней или внешней\s+командой/i,
] as const;

export const isWindowsCommandNotFound = (
  platform: NodeJS.Platform,
  code: number | null,
  stderr: string,
): boolean => {
  if (platform !== "win32") return false;
  if (code === 9009) return true;
  return WINDOWS_COMMAND_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(stderr));
};

export class ProviderCommandNotFoundError extends Schema.TaggedError<ProviderCommandNotFoundError>()(
  "ProviderCommandNotFoundError",
  { binaryPath: Schema.String, exitCode: Schema.Number },
) {
  override get message(): string {
    return `Provider command ${this.binaryPath} was not found (exit code ${this.exitCode}).`;
  }
}

/** A missing command: cmd.exe could not find it, or the spawn failed with ENOENT. */
export const isCommandMissingCause = (error: unknown): boolean =>
  Schema.is(ProviderCommandNotFoundError)(error) ||
  (error instanceof PlatformError.PlatformError && error.reason._tag === "NotFound");

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

const collectText = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(Stream.decodeText(), Stream.mkString);

/** Runs a command to its end and collects its output. */
export const spawnAndCollect = (
  binaryPath: string,
  command: ChildProcess.Command,
  platform: NodeJS.Platform,
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(command);
    const [stdout, stderr, code] = yield* Effect.all(
      [collectText(child.stdout), collectText(child.stderr), Effect.map(child.exitCode, Number)],
      { concurrency: "unbounded" },
    );
    if (isWindowsCommandNotFound(platform, code, stderr)) {
      return yield* new ProviderCommandNotFoundError({ binaryPath, exitCode: code });
    }
    return { stdout, stderr, code } satisfies CommandResult;
  }).pipe(Effect.scoped);

export function parseGenericCliVersion(output: string): string | null {
  return /\bv?(\d+\.\d+\.\d+)\b/.exec(output)?.[1] ?? null;
}

/** A snapshot from a check, stamped with the instance and the time, as T3 Code's `buildServerProvider`. */
export const buildServerProvider = (input: {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly displayName: string;
  readonly probe: ProviderProbeResult;
}) =>
  Effect.map(DateTime.now, (now): ServerProvider => ({
    instanceId: input.instanceId,
    driver: input.driver,
    displayName: input.displayName,
    installed: input.probe.installed,
    version: input.probe.version,
    status: input.probe.status,
    auth: input.probe.auth ?? { status: "unknown" },
    checkedAt: DateTime.formatIso(now),
    ...(input.probe.message === undefined ? {} : { message: input.probe.message }),
    models: input.probe.models ?? [],
  }));

/**
 * `~` and `~/…` in **Binary path** mean the home folder, as T3 Code's
 * `expandHomePath` (`packages/provider-core/src/server/pathExpansion.ts`).
 */
export function expandHomePath(value: string, homeDirectory: string): string {
  if (value === "~") return homeDirectory;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return `${homeDirectory}${value.slice(1)}`;
  }
  return value;
}

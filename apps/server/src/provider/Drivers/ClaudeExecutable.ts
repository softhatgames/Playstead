// @effect-diagnostics nodeBuiltinImport:off -- Windows paths use node:path's win32 rules on every host.
import * as NodePath from "node:path";

import { type HostTarget, resolveExecutable } from "@playstead/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

/** Launcher scripts Node cannot spawn without a shell, and so neither can the Agent SDK. */
const WINDOWS_SHIM_EXTENSIONS: ReadonlySet<string> = new Set([".cmd", ".bat", ".ps1"]);

/** Newer packages ship a native `bin/claude.exe`; older ones only `cli.js`, which the SDK runs with Node. */
const NPM_PACKAGE_ENTRY_CANDIDATES = [
  ["node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"],
  ["node_modules", "@anthropic-ai", "claude-code", "cli.js"],
] as const;

/**
 * The file the Claude Agent SDK should run, following T3 Code's
 * `resolveClaudeSdkExecutablePath`
 * (`apps/server/src/provider/Drivers/ClaudeExecutable.ts` at 2577baf). The SDK
 * spawns without a shell or PATHEXT, so on Windows a bare `claude` or an npm
 * `claude.cmd` shim fails; the shim is mapped to the `claude.exe` (or
 * `cli.js`) installed beside it. Elsewhere the path is used as given.
 */
export const resolveClaudeSdkExecutablePath = Effect.fn("resolveClaudeSdkExecutablePath")(
  function* (binaryPath: string, target: HostTarget) {
    if (target.platform !== "win32") return binaryPath;
    const fs = yield* FileSystem.FileSystem;
    const resolved = (yield* resolveExecutable(binaryPath, target)) ?? binaryPath;
    if (!WINDOWS_SHIM_EXTENSIONS.has(NodePath.win32.extname(resolved).toLowerCase())) {
      return resolved;
    }
    const shimDirectory = NodePath.win32.dirname(resolved);
    for (const segments of NPM_PACKAGE_ENTRY_CANDIDATES) {
      const candidate = NodePath.win32.join(shimDirectory, ...segments);
      const info = yield* fs.stat(candidate).pipe(Effect.orElseSucceed(() => undefined));
      if (info?.type === "File") return candidate;
    }
    yield* Effect.logWarning(
      "Claude launcher shim resolved, but no known package entry was found next to it; the Claude Agent SDK cannot spawn launcher scripts directly.",
    ).pipe(Effect.annotateLogs({ binaryPath, resolvedShimPath: resolved }));
    return binaryPath;
  },
);

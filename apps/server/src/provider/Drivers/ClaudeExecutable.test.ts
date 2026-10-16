import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";

import { resolveClaudeSdkExecutablePath } from "./ClaudeExecutable.ts";

/** A Windows disk holding only these files; Windows names are case-insensitive. */
const windowsFiles = (files: ReadonlyArray<string>) => {
  const present = new Set(files.map((file) => file.toLowerCase()));
  return FileSystem.layerNoop({
    stat: (path) =>
      present.has(path.toLowerCase())
        ? Effect.succeed({ type: "File", mode: 0o644 } as FileSystem.File.Info)
        : Effect.fail(
            PlatformError.systemError({
              _tag: "NotFound",
              module: "FileSystem",
              method: "stat",
              pathOrDescriptor: path,
            }),
          ),
  });
};

const npm = "C:\\Users\\Ana\\AppData\\Roaming\\npm";
const target = { platform: "win32", env: { PATH: npm, PATHEXT: ".EXE;.CMD" } } as const;

describe("resolveClaudeSdkExecutablePath", () => {
  it.effect("maps the npm claude.cmd shim to the claude.exe installed beside it", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveClaudeSdkExecutablePath("claude", target);
      assert.strictEqual(
        resolved.toLowerCase(),
        `${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`.toLowerCase(),
      );
    }).pipe(
      Effect.provide(
        windowsFiles([
          `${npm}\\claude.cmd`,
          `${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`,
        ]),
      ),
    ),
  );

  it.effect("falls back to cli.js for an older package", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveClaudeSdkExecutablePath("claude", target);
      assert.strictEqual(
        resolved.toLowerCase(),
        `${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`.toLowerCase(),
      );
    }).pipe(
      Effect.provide(
        windowsFiles([
          `${npm}\\claude.cmd`,
          `${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`,
        ]),
      ),
    ),
  );

  it.effect("uses the path as given outside Windows", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveClaudeSdkExecutablePath("claude", {
        platform: "darwin",
        env: { PATH: "/usr/local/bin" },
      });
      assert.strictEqual(resolved, "claude");
    }).pipe(Effect.provide(windowsFiles([]))),
  );
});

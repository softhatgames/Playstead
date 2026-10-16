import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";

import { resolveSpawnCommand, withKnownCliDirs } from "./shell.ts";

/**
 * Windows resolution on any host: a file system that holds only the given
 * files, so the rules are checked without a Windows machine. Real processes
 * through `cmd.exe` are covered by the provider registry's tests on Windows.
 */
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

describe("resolveSpawnCommand on Windows", () => {
  // Windows file names are case-insensitive and PATHEXT is tried in upper case
  // first, so the found file is spelled `.CMD`, as in T3 Code.
  it.effect("runs an npm .cmd shim found on PATH through cmd.exe, escaped", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveSpawnCommand("codex", ["app-server"], {
        platform: "win32",
        env: { Path: "C:\\Tools;C:\\Users\\Ana\\AppData\\Roaming\\npm", PATHEXT: ".COM;.EXE;.CMD" },
      });
      assert.deepStrictEqual(resolved, {
        command: '^"C:\\Users\\Ana\\AppData\\Roaming\\npm\\codex.CMD^" ^"app-server^"',
        args: [],
        shell: true,
      });
    }).pipe(Effect.provide(windowsFiles(["C:\\Users\\Ana\\AppData\\Roaming\\npm\\codex.cmd"]))),
  );

  it.effect("starts an .exe directly, without a shell", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveSpawnCommand("claude", ["--version"], {
        platform: "win32",
        env: { PATH: "C:\\Users\\Ana\\.local\\bin" },
      });
      assert.deepStrictEqual(resolved, {
        command: "C:\\Users\\Ana\\.local\\bin\\claude.EXE",
        args: ["--version"],
        shell: false,
      });
    }).pipe(Effect.provide(windowsFiles(["C:\\Users\\Ana\\.local\\bin\\claude.exe"]))),
  );

  it.effect("escapes cmd.exe metacharacters in a shim's path and arguments", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveSpawnCommand("C:\\My Tools (x86)\\codex.cmd", ["a&b"], {
        platform: "win32",
        env: {},
      });
      assert.strictEqual(resolved.command, '^"C:\\My^ Tools^ ^(x86^)\\codex.cmd^" ^"a^&b^"');
      assert.isTrue(resolved.shell);
    }).pipe(Effect.provide(windowsFiles(["C:\\My Tools (x86)\\codex.cmd"]))),
  );

  it.effect("starts a command it cannot find as given, so the spawn reports it missing", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveSpawnCommand("codex", ["app-server"], {
        platform: "win32",
        env: { PATH: "C:\\Tools" },
      });
      assert.deepStrictEqual(resolved, { command: "codex", args: ["app-server"], shell: false });
    }).pipe(Effect.provide(windowsFiles([]))),
  );
});

describe("withKnownCliDirs", () => {
  it("adds T3 Code's known Windows folders to the end of PATH once", () => {
    const env = withKnownCliDirs({
      platform: "win32",
      env: {
        Path: "C:\\Windows;C:\\Users\\Ana\\AppData\\Roaming\\npm",
        APPDATA: "C:\\Users\\Ana\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local",
        USERPROFILE: "C:\\Users\\Ana",
      },
    });
    assert.strictEqual(
      env.Path,
      [
        "C:\\Windows",
        "C:\\Users\\Ana\\AppData\\Roaming\\npm",
        "C:\\Users\\Ana\\AppData\\Local\\Programs\\nodejs",
        "C:\\Users\\Ana\\AppData\\Local\\Volta\\bin",
        "C:\\Users\\Ana\\AppData\\Local\\pnpm",
        "C:\\Users\\Ana\\.local\\bin",
        "C:\\Users\\Ana\\.bun\\bin",
        "C:\\Users\\Ana\\scoop\\shims",
      ].join(";"),
    );
  });

  it("leaves PATH alone elsewhere", () => {
    const env = { PATH: "/usr/bin", HOME: "/Users/ana" };
    assert.strictEqual(withKnownCliDirs({ platform: "darwin", env }), env);
  });
});

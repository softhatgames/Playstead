// @effect-diagnostics preferSchemaOverJson:off -- The stub's source is written as JavaScript text.
import * as HostProcess from "@playstead/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export interface FakeCliOptions {
  readonly directory: string;
  /** The command name, such as `codex`. */
  readonly name: string;
  /** The Node script the command runs, as an ES module. */
  readonly source: string;
  /** Variables the stub sets on itself before its source runs. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Writes a fake command as T3 Code's `writeFakeCli` does
 * (`packages/provider-testing/src/fakeCli.ts` at 2577baf): a Node script and
 * a launcher, a `.cmd` shim on Windows (which runs through `cmd.exe` like an
 * npm install) and a `#!/bin/sh` script elsewhere. Returns the launcher.
 */
export const writeFakeCli = Effect.fn("writeFakeCli")(function* (options: FakeCliOptions) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  yield* fs.makeDirectory(options.directory, { recursive: true });
  const stubName = `${options.name}-stub.mjs`;
  // The variables ride in a JSON file the stub reads, since neither sh nor
  // cmd.exe can quote every value safely.
  const envPath = path.join(options.directory, `${options.name}-env.json`);
  yield* fs.writeFileString(envPath, JSON.stringify(options.env ?? {}));
  yield* fs.writeFileString(
    path.join(options.directory, stubName),
    [
      'import { readFileSync as readFakeCliEnv } from "node:fs";',
      `Object.assign(process.env, JSON.parse(readFakeCliEnv(${JSON.stringify(envPath)}, "utf8")));`,
      options.source,
    ].join("\n"),
  );

  if (platform === "win32") {
    const launcher = path.join(options.directory, `${options.name}.cmd`);
    yield* fs.writeFileString(
      launcher,
      ["@echo off", `node "%~dp0${stubName}" %*`, "exit /b %ERRORLEVEL%", ""].join("\r\n"),
    );
    return launcher;
  }
  const launcher = path.join(options.directory, options.name);
  yield* fs.writeFileString(
    launcher,
    // `${0%/*}` instead of T3 Code's `$(dirname "$0")`, so a PATH without
    // the system folders still runs it.
    ["#!/bin/sh", `exec node "\${0%/*}/${stubName}" "$@"`, ""].join("\n"),
  );
  yield* fs.chmod(launcher, 0o755);
  return launcher;
});

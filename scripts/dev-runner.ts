// @effect-diagnostics nodeBuiltinImport:off -- Port probing needs plain Node sockets.
import * as NodeNet from "node:net";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { resolveGitWorktreePath, resolveWorktreePlaysteadHome } from "@playstead/shared/devHome";
import { identity } from "@playstead/shared/identity";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Effect from "effect/Effect";
import * as Hash from "effect/Hash";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { ChildProcess } from "effect/process";

export const DEV_RUNNER_MODES = ["dev", "dev:server", "dev:web"] as const;
export type DevMode = (typeof DEV_RUNNER_MODES)[number];

/** Away from T3 Code's 13773 and 5733, so both can run side by side. */
export const BASE_SERVER_PORT = 14773;
export const BASE_WEB_PORT = 5833;
const MAX_OFFSET = 3000;

const MODE_ARGS: Record<DevMode, ReadonlyArray<string>> = {
  dev: ["run", "--filter=@playstead/web", "--filter=@playstead/server", "--parallel", "dev"],
  "dev:server": ["run", "--filter=@playstead/server", "dev"],
  "dev:web": ["run", "--filter=@playstead/web", "dev"],
};

const variable = (name: string) => `${identity.environmentVariablePrefix}${name}`;

/**
 * The only inherited variables a child gets: what finding and running
 * programs, the home folder, temporary files, the locale and the terminal need
 * on macOS, Linux and Windows. Everything else stays behind, including
 * T3 Code's `T3CODE_*`, `ELECTRON_RUN_AS_NODE` and the agent's own variables.
 *
 * Providers run with the server's environment, as in T3 Code, so this list is
 * also what Codex and Claude get. Finding them needs only PATH, PATHEXT and
 * the Windows folders below (`APPDATA`, `LOCALAPPDATA`, `USERPROFILE`) that
 * T3 Code's known install folders are under. `CODEX_HOME` and
 * `CLAUDE_CONFIG_DIR` pass because they say where the person's own
 * `codex login` and `claude auth login` live. API keys such as
 * `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `CODEX_API_KEY` do not: one in a
 * development shell is most likely the agent's or a stray, and an inherited
 * key would sign Claude in with it.
 */
export const INHERITED_VARIABLES = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMDATA",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
] as const;

const INHERITED = new Set<string>(INHERITED_VARIABLES);

export interface CreateDevRunnerEnvInput {
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly serverPort: number;
  readonly webPort: number;
  /** A worktree's own home or `--home-dir`; otherwise the server uses `~/.playstead`. */
  readonly playsteadHome: string | undefined;
}

/**
 * The children's whole environment. Unlike T3 Code's runner, which copies the
 * shell's environment and deletes a few keys, this starts empty and adds only
 * what the children need. Windows names variables case-insensitively, so they
 * are matched that way and keep the case they came with.
 */
export function createDevRunnerEnv(input: CreateDevRunnerEnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.baseEnv)) {
    if (value !== undefined && INHERITED.has(name.toUpperCase())) env[name] = value;
  }
  env[variable("PORT")] = String(input.serverPort);
  env[variable("WEB_PORT")] = String(input.webPort);
  env[variable("DEV_URL")] = `http://localhost:${input.webPort}/`;
  if (input.playsteadHome !== undefined) env[identity.home.variable] = input.playsteadHome;
  return env;
}

/** A worktree's ports move by a hash of its path, so two checkouts can run at once. */
export const resolveOffset = (worktreePath: string | undefined) =>
  worktreePath === undefined ? 0 : (Math.abs(Hash.string(worktreePath)) % MAX_OFFSET) + 1;

const canListen = (port: number) =>
  Effect.callback<boolean>((resume) => {
    const probe = NodeNet.createServer();
    probe.once("error", () => resume(Effect.succeed(false)));
    probe.listen({ host: "127.0.0.1", port }, () =>
      probe.close(() => resume(Effect.succeed(true))),
    );
  });

const findFreeOffset = (mode: DevMode, start: number) =>
  Effect.gen(function* () {
    for (let offset = start; offset < start + 100; offset++) {
      const serverFree = mode === "dev:web" || (yield* canListen(BASE_SERVER_PORT + offset));
      const webFree = mode === "dev:server" || (yield* canListen(BASE_WEB_PORT + offset));
      if (serverFree && webFree) return offset;
    }
    return start;
  });

const runDevRunner = (input: {
  readonly mode: DevMode;
  readonly homeDir: Option.Option<string>;
  readonly dryRun: boolean;
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const cwd = process.cwd();
    const worktreePath = yield* resolveGitWorktreePath(cwd);
    const offset = yield* findFreeOffset(input.mode, resolveOffset(worktreePath));
    const playsteadHome = Option.isSome(input.homeDir)
      ? path.resolve(input.homeDir.value)
      : yield* resolveWorktreePlaysteadHome(cwd);
    const env = createDevRunnerEnv({
      baseEnv: process.env,
      serverPort: BASE_SERVER_PORT + offset,
      webPort: BASE_WEB_PORT + offset,
      playsteadHome,
    });
    yield* Effect.logInfo(
      `[dev-runner] mode=${input.mode} serverPort=${env[variable("PORT")]} webPort=${env[variable("WEB_PORT")]} home=${playsteadHome ?? `~/${identity.home.directoryName}`}`,
    );
    if (input.dryRun) return;

    const child = yield* ChildProcess.make("vp", MODE_ARGS[input.mode], {
      env,
      extendEnv: false,
      // `vp` is a `.cmd` shim on Windows, which only a shell runs.
      shell: process.platform === "win32",
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      forceKillAfter: "1500 millis",
    });
    const exitCode = yield* child.exitCode;
    if (exitCode !== 0) return yield* Effect.die(`vp exited with code ${exitCode}`);
  });

const devRunnerCli = Command.make("dev-runner", {
  mode: Argument.Literals("mode", DEV_RUNNER_MODES).pipe(
    Argument.withDescription("Development mode to run."),
  ),
  homeDir: Flag.String("home-dir").pipe(
    Flag.withDescription(
      "The Playstead home for this run. Inside a Git worktree it defaults to the worktree's own .playstead.",
    ),
    Flag.optional,
  ),
  dryRun: Flag.Boolean("dry-run").pipe(
    Flag.withDescription("Resolve ports, home and environment, print them, and start nothing."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Run Playstead's development modes with their ports and environment."),
  Command.withHandler(runDevRunner),
);

if (import.meta.main) {
  Command.run(devRunnerCli, { version: "0.0.0" }).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}

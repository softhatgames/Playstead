// @effect-diagnostics nodeBuiltinImport:off -- Windows paths are resolved with node:path's win32 rules on every host.
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

/**
 * Finding and starting programs the way T3 Code does at 2577baf
 * (`packages/shared/src/shell.ts`): PATH with PATHEXT, T3 Code's known
 * Windows install folders, and `.cmd` shims through `cmd.exe`.
 *
 * Nothing is cached: a refresh must see an install made a moment ago.
 */

export type ProcessEnvironment = Readonly<Record<string, string | undefined>>;

export interface HostTarget {
  readonly platform: NodeJS.Platform;
  readonly env: ProcessEnvironment;
}

const pathModule = (platform: NodeJS.Platform) =>
  platform === "win32" ? NodePath.win32 : NodePath.posix;

const pathDelimiter = (platform: NodeJS.Platform) => (platform === "win32" ? ";" : ":");

/** Windows spells it `Path`, and names are case-insensitive there. */
const pathVariableName = (env: ProcessEnvironment) =>
  Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";

const stripWrappingQuotes = (value: string) => value.replace(/^"+|"+$/g, "");

function resolveWindowsPathExtensions(env: ProcessEnvironment): ReadonlyArray<string> {
  const fallback = [".COM", ".EXE", ".BAT", ".CMD"];
  const raw = env[Object.keys(env).find((name) => name.toUpperCase() === "PATHEXT") ?? "PATHEXT"];
  if (!raw) return fallback;
  const parsed = raw
    .split(";")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
  return parsed.length > 0 ? [...new Set(parsed)] : fallback;
}

/** Where npm, Node, Volta, pnpm, `~/.local`, Bun and Scoop put command shims on Windows. */
function resolveKnownWindowsCliDirs(env: ProcessEnvironment): ReadonlyArray<string> {
  const appData = env.APPDATA?.trim();
  const localAppData = env.LOCALAPPDATA?.trim();
  const userProfile = env.USERPROFILE?.trim();
  return [
    ...(appData ? [`${appData}\\npm`] : []),
    ...(localAppData
      ? [
          `${localAppData}\\Programs\\nodejs`,
          `${localAppData}\\Volta\\bin`,
          `${localAppData}\\pnpm`,
        ]
      : []),
    ...(userProfile
      ? [`${userProfile}\\.local\\bin`, `${userProfile}\\.bun\\bin`, `${userProfile}\\scoop\\shims`]
      : []),
  ];
}

/**
 * The environment providers are found and started with. On Windows, T3 Code's
 * known folders join the end of PATH, so a provider installed with npm, Volta,
 * pnpm, Bun or Scoop is found even when an app started before the install.
 */
export function withKnownCliDirs({ platform, env }: HostTarget): ProcessEnvironment {
  if (platform !== "win32") return env;
  const name = pathVariableName(env);
  const entries = (env[name] ?? "").split(";").filter((entry) => entry.trim().length > 0);
  const seen = new Set(entries.map((entry) => stripWrappingQuotes(entry.trim()).toLowerCase()));
  for (const directory of resolveKnownWindowsCliDirs(env)) {
    if (seen.has(directory.toLowerCase())) continue;
    seen.add(directory.toLowerCase());
    entries.push(directory);
  }
  return { ...env, [name]: entries.join(";") };
}

function commandCandidates(
  command: string,
  platform: NodeJS.Platform,
  extensions: ReadonlyArray<string>,
) {
  if (platform !== "win32") return [command];
  const extension = NodePath.win32.extname(command);
  if (extension.length > 0 && extensions.includes(extension.toUpperCase())) {
    const stem = command.slice(0, -extension.length);
    return [
      ...new Set([
        command,
        `${stem}${extension.toUpperCase()}`,
        `${stem}${extension.toLowerCase()}`,
      ]),
    ];
  }
  return [
    ...new Set(
      extensions.flatMap((candidate) => [
        `${command}${candidate}`,
        `${command}${candidate.toLowerCase()}`,
      ]),
    ),
  ];
}

const isExecutableFile = (
  filePath: string,
  platform: NodeJS.Platform,
  extensions: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat(filePath).pipe(Effect.orElseSucceed(() => undefined));
    if (info === undefined || info.type !== "File") return false;
    if (platform === "win32") {
      return extensions.includes(NodePath.win32.extname(filePath).toUpperCase());
    }
    return (info.mode & 0o111) !== 0;
  });

/**
 * The file a command runs: a path is checked as given, a bare name is looked
 * up on PATH. On Windows a match needs a PATHEXT extension; elsewhere it needs
 * an execute bit.
 */
export const resolveExecutable = Effect.fn("shell.resolveExecutable")(function* (
  command: string,
  { platform, env }: HostTarget,
) {
  const path = pathModule(platform);
  const extensions = platform === "win32" ? resolveWindowsPathExtensions(env) : [];
  const candidates = commandCandidates(command, platform, extensions);
  if (command.includes("/") || command.includes("\\")) {
    for (const candidate of candidates) {
      if (yield* isExecutableFile(candidate, platform, extensions)) return candidate;
    }
    return undefined;
  }
  const entries = (env[pathVariableName(env)] ?? "")
    .split(pathDelimiter(platform))
    .map((entry) => stripWrappingQuotes(entry.trim()))
    .filter((entry) => entry.length > 0);
  for (const entry of new Set(entries)) {
    for (const candidate of candidates) {
      const candidatePath = path.join(entry, candidate);
      if (yield* isExecutableFile(candidatePath, platform, extensions)) return candidatePath;
    }
  }
  return undefined;
});

const WINDOWS_SHELL_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

/**
 * `cmd.exe /d /s /c "<line>"` gets the line unquoted, so each argument is
 * quoted for `CommandLineToArgvW` and its metacharacters escaped for cmd.exe.
 */
function escapeWindowsShellArg(arg: string): string {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return quoted.replace(WINDOWS_SHELL_META_CHARS, "^$1");
}

export interface ResolvedSpawnCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly shell: boolean;
}

/**
 * How to start a command. Elsewhere than Windows it starts as given. On
 * Windows it starts the resolved file, and a `.cmd` or `.bat` shim runs
 * through `cmd.exe` as one escaped line, which avoids Node's DEP0190 warning.
 * A command that cannot be resolved is started as given, so its spawn fails
 * and reports it missing.
 */
export const resolveSpawnCommand = Effect.fn("shell.resolveSpawnCommand")(function* (
  command: string,
  args: ReadonlyArray<string>,
  target: HostTarget,
) {
  if (target.platform !== "win32")
    return { command, args, shell: false } satisfies ResolvedSpawnCommand;
  const resolved = (yield* resolveExecutable(command, target)) ?? command;
  const extension = NodePath.win32.extname(resolved).toLowerCase();
  if (extension !== ".cmd" && extension !== ".bat") {
    return { command: resolved, args, shell: false } satisfies ResolvedSpawnCommand;
  }
  return {
    command: [resolved, ...args].map(escapeWindowsShellArg).join(" "),
    args: [],
    shell: true,
  } satisfies ResolvedSpawnCommand;
});

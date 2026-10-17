// @effect-diagnostics nodeBuiltinImport:off -- A launcher script on plain Node, as T3 Code's is.
// @effect-diagnostics globalConsole:off -- It reports to the terminal or the CI log.
// @effect-diagnostics globalTimers:off -- It boots the app for a few seconds.
// @effect-diagnostics globalDate:off -- It times the boot with the wall clock.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { identity } from "@playstead/shared/identity";

import { createElectronEnv, desktopDir, resolveElectronCommand } from "./electron-launcher.ts";

/**
 * Boots the built desktop app for a few seconds, outside development, and
 * fails on error output such as a missing module or an uncaught error. After
 * T3 Code's `apps/desktop/scripts/smoke-test.mjs`; Playstead's also waits for
 * the window to show the interface, and keeps the app's data in a temporary
 * folder.
 *
 *   vp run build && vp run smoke:desktop
 */

const READY_LINE = "[desktop] The window shows the interface.";
const STARTUP_BUDGET_MS = 60_000;
const RUN_AFTER_READY_MS = 4_000;
const FATAL_PATTERNS = [
  "Cannot find module",
  "MODULE_NOT_FOUND",
  "Refused to execute",
  "Uncaught Error",
  "Uncaught TypeError",
  "Uncaught ReferenceError",
  "failed to start",
  "blocked by CORS policy",
];

const required = [
  NodePath.join(desktopDir, "dist-electron", "main.cjs"),
  NodePath.join(desktopDir, "dist-electron", "preload.cjs"),
  NodePath.join(desktopDir, "..", "server", "dist", "bin.mjs"),
  NodePath.join(desktopDir, "..", "server", "dist", "client", "index.html"),
];
const missing = required.filter((file) => !NodeFS.existsSync(file));
if (missing.length > 0) {
  console.error(`Build the desktop app first (\`vp run build\`); missing:\n${missing.join("\n")}`);
  process.exit(1);
}

const temporary = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "playstead-smoke-"));
const env = Object.fromEntries(
  Object.entries(createElectronEnv(process.env)).filter(
    ([name]) => !name.toUpperCase().startsWith(identity.environmentVariablePrefix),
  ),
);
env[identity.home.variable] = NodePath.join(temporary, "home");
env.ELECTRON_ENABLE_LOGGING = "1";

const { command, args } = resolveElectronCommand({ development: false });
const child = NodeChildProcess.spawn(
  command,
  [...args, `--user-data-dir=${NodePath.join(temporary, "user-data")}`],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);

let output = "";
let failure: string | undefined;
let readyAt: number | undefined;
const startedAt = Date.now();

const onOutput = (chunk: Buffer, sink: NodeJS.WriteStream) => {
  const text = chunk.toString();
  sink.write(text);
  output += text;
  failure ??= FATAL_PATTERNS.find((pattern) => output.includes(pattern));
  if (readyAt === undefined && output.includes(READY_LINE)) readyAt = Date.now();
};
child.stdout.on("data", (chunk: Buffer) => onOutput(chunk, process.stdout));
child.stderr.on("data", (chunk: Buffer) => onOutput(chunk, process.stderr));

/** Electron and the server it started; on Windows only `taskkill /T` reaches the server. */
const stop = () =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
    if (process.platform === "win32" && child.pid !== undefined) {
      NodeChildProcess.spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    } else {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }
  });

const removeTemporary = async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      NodeFS.rmSync(temporary, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
};

const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
let verdict: string | undefined;
for (;;) {
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 250))]);
  if (failure !== undefined) {
    verdict = `the app printed "${failure}"`;
    break;
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    verdict = `the app exited early (${child.exitCode ?? child.signalCode})`;
    break;
  }
  if (readyAt !== undefined && Date.now() - readyAt >= RUN_AFTER_READY_MS) break;
  if (readyAt === undefined && Date.now() - startedAt >= STARTUP_BUDGET_MS) {
    verdict = `the window did not show the interface within ${STARTUP_BUDGET_MS / 1000} s`;
    break;
  }
}

await stop();
await removeTemporary();
if (verdict !== undefined) {
  console.error(`\nDesktop smoke boot failed: ${verdict}.`);
  process.exit(1);
}
console.log("\nDesktop smoke boot passed.");

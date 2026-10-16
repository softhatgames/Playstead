// @effect-diagnostics nodeBuiltinImport:off -- A launcher script on plain Node, as T3 Code's is.
// @effect-diagnostics globalConsole:off -- It reports to the developer's terminal.
// @effect-diagnostics globalTimers:off -- It polls Vite's port before starting Electron.
import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";

import { identity } from "@playstead/shared/identity";

import { createElectronEnv, resolveElectronCommand } from "./electron-launcher.ts";

/**
 * Starts the development desktop app once Vite answers, after T3 Code's
 * `apps/desktop/scripts/dev-electron.mjs`. `vp run dev:desktop` runs it with
 * the development runner's variables; it removes what the shell must not
 * pass on and ends when the app quits.
 */

const devUrlVariable = `${identity.environmentVariablePrefix}DEV_URL`;
const devUrl = process.env[devUrlVariable];
if (devUrl === undefined || URL.parse(devUrl)?.port === "") {
  console.error(
    `${devUrlVariable} must name Vite's address with its port; run \`vp run dev:desktop\`.`,
  );
  process.exit(1);
}
const vite = new URL(devUrl);

const canConnect = () =>
  new Promise<boolean>((resolve) => {
    const socket = NodeNet.connect({ host: vite.hostname, port: Number(vite.port) });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

while (!(await canConnect())) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}

const { command, args } = resolveElectronCommand({ development: true });
const child = NodeChildProcess.spawn(command, args, {
  env: createElectronEnv(process.env),
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(code ?? (signal === null ? 0 : 1)));

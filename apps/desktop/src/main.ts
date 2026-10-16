// @effect-diagnostics nodeBuiltinImport:off -- The main process reads its own location and makes a secret with Node.
// @effect-diagnostics globalConsole:off -- The smoke boot reads these lines from the app's output.
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type DesktopEnvironmentBootstrap,
  PRIMARY_LOCAL_ENVIRONMENT_ID,
} from "@playstead/contracts/ipc";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { app, dialog, type BrowserWindow } from "electron";

import { DEFAULT_BACKEND_PORT, resolveDesktopEnvironment } from "./app/DesktopEnvironment.ts";
import { awaitBackendReady, makeDesktopBackend } from "./backend/DesktopBackend.ts";
import { exchangeBootstrapToken } from "./backend/DesktopLocalEnvironmentAuth.ts";
import { findAvailablePort } from "./backend/ports.ts";
import { handleDesktopProtocol, registerSchemePrivileges } from "./electron/protocol.ts";
import { installIpcHandlers } from "./ipc/handlers.ts";
import { createMainWindow } from "./window.ts";

/**
 * The desktop app, as T3 Code's `apps/desktop/src/main.ts` and
 * `app/DesktopApp.ts` run it: identity and paths before `ready`, then the
 * server, and the window only once the server answers its descriptor.
 */

const runtime = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer));

const environment = resolveDesktopEnvironment(runtime.runSync(Effect.service(Path.Path)), {
  env: process.env,
  homeDirectory: NodeOS.homedir(),
  appDataDirectory: app.getPath("appData"),
  // `dist-electron/main.cjs` sits in `apps/desktop`.
  desktopDir: NodePath.join(__dirname, ".."),
  argv: process.argv,
});

registerSchemePrivileges();
app.setPath("userData", environment.userDataPath);
app.setName(environment.displayName);
app.setAboutPanelOptions({ applicationName: environment.displayName });
if (process.platform === "win32") app.setAppUserModelId(environment.appId);

const backendScope = Scope.makeUnsafe();
const bootstrapToken = NodeCrypto.randomBytes(32).toString("hex");
let httpBaseUrl: string | undefined;
let bearerToken: Promise<string> | undefined;
let mainWindow: BrowserWindow | undefined;

const bootstraps = (): ReadonlyArray<DesktopEnvironmentBootstrap> => {
  if (httpBaseUrl === undefined) return [];
  const wsBaseUrl = new URL(httpBaseUrl);
  wsBaseUrl.protocol = "ws:";
  return [
    {
      id: PRIMARY_LOCAL_ENVIRONMENT_ID,
      label: "This computer",
      httpBaseUrl,
      wsBaseUrl: wsBaseUrl.toString(),
    },
  ];
};

/** One bearer token per run; a failed exchange is tried again on the next request. */
const getBearerToken = () => {
  if (httpBaseUrl === undefined) return Promise.reject(new Error("The server is not ready."));
  const url = httpBaseUrl;
  bearerToken ??= runtime
    .runPromise(exchangeBootstrapToken({ httpBaseUrl: url, bootstrapToken }))
    .catch((error: unknown) => {
      bearerToken = undefined;
      throw error;
    });
  return bearerToken;
};

const failStartup = (error: unknown) => {
  console.error("Playstead failed to start:", error);
  dialog.showErrorBox(
    `${environment.displayName} failed to start`,
    error instanceof Error ? error.message : String(error),
  );
  app.exit(1);
};

const start = Effect.gen(function* () {
  if (environment.isDevelopment && environment.backendPort === undefined) {
    return yield* Effect.die(
      "Development needs the server's port in PLAYSTEAD_PORT; start it with `vp run dev:desktop`.",
    );
  }
  const port = environment.backendPort ?? (yield* findAvailablePort(DEFAULT_BACKEND_PORT));
  const backend = yield* makeDesktopBackend({
    // Electron's own binary, run as Node by `ELECTRON_RUN_AS_NODE`.
    executablePath: process.execPath,
    entryPath: environment.backendEntryPath,
    baseEnv: process.env,
    bootstrap: {
      port,
      playsteadHome: environment.playsteadHome,
      ...(environment.devUrl === undefined ? {} : { devUrl: environment.devUrl }),
      desktopBootstrapToken: bootstrapToken,
    },
  }).pipe(Scope.provide(backendScope));
  return yield* awaitBackendReady(backend);
});

void app.whenReady().then(async () => {
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(environment.iconPaths.macPng);
  }
  handleDesktopProtocol(
    environment.urlScheme,
    environment.devUrl === undefined
      ? { assetDirectory: environment.clientAssetsDir }
      : { devUrl: environment.devUrl },
  );
  installIpcHandlers({ environment, bootstraps, bearerToken: getBearerToken });

  const ready = await runtime.runPromiseExit(start);
  if (Exit.isFailure(ready)) return failStartup(ready.cause);
  httpBaseUrl = ready.value.httpBaseUrl;
  console.log(`[desktop] The server is ready at ${httpBaseUrl}.`);
  mainWindow = createMainWindow(environment);
  mainWindow.once("ready-to-show", () => console.log("[desktop] The window shows the interface."));
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}, failStartup);

// One window and one server: closing the window ends the app on every platform.
app.on("window-all-closed", () => app.quit());

let stopped = false;
app.on("before-quit", (event) => {
  if (stopped) return;
  event.preventDefault();
  void runtime
    .runPromise(Scope.close(backendScope, Exit.void))
    .finally(() => runtime.dispose())
    .finally(() => {
      stopped = true;
      app.quit();
    });
});

// @effect-diagnostics nodeBuiltinImport:off -- The test listener is a plain Node HTTP server.
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Queue from "effect/Queue";
import * as References from "effect/References";
import * as Schedule from "effect/Schedule";
import * as HttpServer from "effect/http/HttpServer";

import * as HostProcess from "@playstead/shared/hostProcess";

import * as ServerConfig from "../config.ts";
import { layerServer } from "../server.ts";
import type { StartupOptions } from "../serverRuntimeStartup.ts";

/**
 * A temporary Playstead home, removed when the scope closes. Windows keeps a
 * file busy for a moment after it closes, so removal retries on EBUSY and
 * EPERM.
 */
const makeTempHome = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* Effect.acquireRelease(
    fs.makeTempDirectory({ prefix: "playstead-home-" }),
    (directory) =>
      fs.remove(directory, { recursive: true }).pipe(
        Effect.retry({
          while: (error) =>
            error.reason._tag === "Busy" || error.reason._tag === "PermissionDenied",
          schedule: Schedule.exponential("20 millis"),
          times: 10,
        }),
        Effect.ignore,
      ),
  );
});

export interface TestServerOptions extends StartupOptions {
  readonly devUrl?: URL;
  readonly desktopBootstrapToken?: string;
  /**
   * The environment providers are found and started with. By default PATH is
   * empty, so no test reaches a provider installed on the machine.
   */
  readonly providerEnvironment?: Readonly<Record<string, string | undefined>>;
}

export interface TestServer {
  readonly baseUrl: string;
  readonly config: ServerConfig.ServerConfig["Service"];
  /** Every message the server logs, at debug level and above, with its annotations. */
  readonly logs: Queue.Dequeue<string>;
}

/**
 * The real server, in a temporary Playstead home, on a free port of
 * `127.0.0.1`. It stops when the scope closes.
 */
export const startTestServer = Effect.fn("startTestServer")(function* (
  options: TestServerOptions = {},
) {
  const home = yield* makeTempHome;
  const paths = yield* ServerConfig.deriveServerPaths(home, options.devUrl);
  const config = ServerConfig.ServerConfig.of({
    cwd: home,
    baseDir: home,
    ...paths,
    port: 0,
    devUrl: options.devUrl,
    staticDir: undefined,
    desktopBootstrapToken: options.desktopBootstrapToken,
  });
  const logs = yield* Queue.unbounded<string>();
  const captureLogs = Logger.make(({ message, fiber }) => {
    const text = Array.isArray(message) ? message.map(String).join(" ") : String(message);
    const annotations = Object.entries(fiber.getRef(References.CurrentLogAnnotations)).map(
      ([key, value]) => ` ${key}=${String(value)}`,
    );
    Queue.offerUnsafe(logs, `${text}${annotations.join("")}`);
  });

  const context = yield* Layer.build(
    layerServer(options).pipe(
      Layer.provideMerge(
        NodeHttpServer.layer(NodeHttp.createServer, { host: "127.0.0.1", port: 0 }),
      ),
      Layer.provide(ServerConfig.layer(config)),
      Layer.provide(
        Layer.succeed(HostProcess.Environment, options.providerEnvironment ?? { PATH: "" }),
      ),
      Layer.provide(Logger.layer([captureLogs])),
      Layer.provide(Layer.succeed(References.MinimumLogLevel, "Debug")),
    ),
  );
  const server = yield* HttpServer.HttpServer.pipe(Effect.provideContext(context));
  const address = server.address;
  if (!("port" in address)) return yield* Effect.die("The test server has no TCP port.");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    config,
    logs,
  } satisfies TestServer;
});

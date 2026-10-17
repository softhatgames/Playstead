import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Queue from "effect/Queue";
import * as References from "effect/References";
import * as HttpServer from "effect/http/HttpServer";
import * as NetAddress from "effect/net/NetAddress";

import * as HostProcess from "@playstead/shared/hostProcess";
import { makeTempDirectoryScoped } from "@playstead/shared/tempDirectory";

import * as ServerConfig from "../config.ts";
import { layerHttpServer, layerServer } from "../server.ts";
import type { StartupOptions } from "../serverRuntimeStartup.ts";

/** A temporary Playstead home, removed when the scope closes. */
export const makeTempHome = makeTempDirectoryScoped("playstead-home-");

/** The server's config over a temporary Playstead home. */
export const makeTestServerConfig = Effect.fn("makeTestServerConfig")(function* (
  options: { readonly devUrl?: URL; readonly desktopBootstrapToken?: string } = {},
) {
  const home = yield* makeTempHome;
  const paths = yield* ServerConfig.deriveServerPaths(home, options.devUrl);
  return ServerConfig.ServerConfig.of({
    cwd: home,
    baseDir: home,
    ...paths,
    port: 0,
    devUrl: options.devUrl,
    staticDir: undefined,
    desktopBootstrapToken: options.desktopBootstrapToken,
  });
});

export interface TestServerOptions extends StartupOptions {
  readonly devUrl?: URL;
  readonly desktopBootstrapToken?: string;
  /** An existing home, for a server started again over another one's state. */
  readonly config?: ServerConfig.ServerConfig["Service"];
  /**
   * The environment providers are found and started with. By default PATH is
   * empty, so no test reaches a provider installed on the machine.
   */
  readonly providerEnvironment?: Readonly<Record<string, string | undefined>>;
}

export interface TestServer {
  readonly baseUrl: string;
  /** The address the server's listener is bound to. */
  readonly listeningOn: string;
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
  const config = options.config ?? (yield* makeTestServerConfig(options));
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
      Layer.provideMerge(layerHttpServer(0)),
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
    listeningOn: NetAddress.formatIp(address.address),
    config,
    logs,
  } satisfies TestServer;
});

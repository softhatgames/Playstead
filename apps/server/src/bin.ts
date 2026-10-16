// @effect-diagnostics nodeBuiltinImport:off -- The listener and port probe are plain Node.
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "./config.ts";
import { layerServer } from "./server.ts";

/** The server listens on this computer only. */
const HOST = "127.0.0.1";

const canListen = (port: number) =>
  Effect.callback<boolean>((resume) => {
    const probe = NodeNet.createServer();
    probe.once("error", () => resume(Effect.succeed(false)));
    probe.listen({ host: HOST, port }, () => probe.close(() => resume(Effect.succeed(true))));
  });

const findAvailablePort = (preferred: number) =>
  Effect.gen(function* () {
    for (let port = preferred; port < preferred + 100; port++) {
      if (yield* canListen(port)) return port;
    }
    return 0;
  });

const program = Effect.gen(function* () {
  const config = yield* ServerConfig.resolveServerConfig({
    cwd: process.cwd(),
    homeDirectory: NodeOS.homedir(),
    findPort: findAvailablePort,
  });
  yield* Effect.logInfo("Starting the Playstead server").pipe(
    Effect.annotateLogs({ stateDir: config.stateDir, port: config.port }),
  );
  return yield* Layer.launch(
    layerServer().pipe(
      Layer.provideMerge(
        NodeHttpServer.layer(NodeHttp.createServer, { host: HOST, port: config.port }),
      ),
      Layer.provide(ServerConfig.layer(config)),
    ),
  );
});

program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);

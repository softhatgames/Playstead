import { EnvironmentHttpApi } from "@playstead/contracts/environmentHttp";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as AuthHttp from "./auth/http.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import * as ServerConfig from "./config.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as ServerHttp from "./http.ts";
import * as OrchestrationRuntime from "./orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "./persistence/Sqlite.ts";
import * as ProjectService from "./project/ProjectService.ts";
import * as ProviderRegistry from "./provider/ProviderRegistry.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";
import * as WorkspacePaths from "./workspace/WorkspacePaths.ts";
import * as Ws from "./ws.ts";

/**
 * The server's routes. The environment HTTP API, `/ws` and the interface's
 * files are all there is.
 */
const layerRoutes = Layer.mergeAll(
  HttpApiBuilder.layer(EnvironmentHttpApi).pipe(
    Layer.provide(AuthHttp.layer),
    Layer.provide(ServerHttp.layerServerEnvironmentHttpApi),
    Layer.provide(AuthHttp.layerAuthenticatedAuth),
  ),
  Ws.layer,
  ServerHttp.layerStaticAndDevRoute,
).pipe(
  Layer.provide(ServerHttp.layerCommandReadiness),
  Layer.provide(ServerHttp.layerDesktopWindowCors),
);

const layerHttpListening = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* HttpServer.HttpServer;
    const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
    yield* startup.markHttpListening;
  }),
);

/**
 * In a browser the person signs in with a one-time link, printed once the
 * server takes commands. In development it opens the Vite page.
 */
const layerStartupPairingLink = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const server = yield* HttpServer.HttpServer;
    const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const address = server.address;
    const baseUrl =
      config.devUrl?.toString() ??
      ("port" in address ? `http://localhost:${address.port}/` : undefined);
    if (baseUrl === undefined) return;
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        yield* startup.awaitCommandReady;
        const pairingUrl = yield* auth.issueStartupPairingUrl(baseUrl);
        yield* Effect.logInfo("Open Playstead in a browser with the pairing link.").pipe(
          Effect.annotateLogs({ pairingUrl }),
        );
      }).pipe(Effect.ignoreCause({ log: true })),
    );
  }),
);

const layerRuntimeServices = Layer.mergeAll(
  EnvironmentAuth.layer,
  ServerLifecycleEvents.layer,
  ProviderRegistry.layer.pipe(Layer.provideMerge(ServerSettings.layer)),
  ProjectService.layer.pipe(
    Layer.provideMerge(OrchestrationRuntime.layer),
    Layer.provide(WorkspacePaths.layer),
  ),
).pipe(
  Layer.provideMerge(ServerEnvironment.layer),
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provideMerge(SqlitePersistence.layerConfig),
);

/**
 * Everything but the HTTP listener and the platform: the binary listens on
 * `127.0.0.1`, and tests listen on a free port.
 */
export const layerServer = (options?: ServerRuntimeStartup.StartupOptions) =>
  Layer.mergeAll(
    HttpRouter.serve(layerRoutes, { disableLogger: true }),
    layerHttpListening,
    layerStartupPairingLink,
  ).pipe(
    Layer.provideMerge(ServerRuntimeStartup.layerWithOptions(options)),
    Layer.provideMerge(layerRuntimeServices),
  );

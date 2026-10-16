import { EnvironmentHttpApi } from "@playstead/contracts/environmentHttp";
import { isDevProxiedPath } from "@playstead/shared/devProxy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerRespondable from "effect/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpStaticServer from "effect/http/HttpStaticServer";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as ServerConfig from "./config.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";

export const layerServerEnvironmentHttpApi = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "metadata",
  Effect.fnUntraced(function* (handlers) {
    const environment = yield* ServerEnvironment.ServerEnvironment;
    return handlers.handle("descriptor", () => environment.getDescriptor);
  }),
);

/**
 * Every request waits until startup completes: the descriptor, signing in,
 * `/ws` and the interface's files. The descriptor needs no gate of its own.
 */
export const layerCommandReadiness = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
      if (!(yield* startup.isCommandReady)) {
        yield* Effect.logDebug("Holding a request until startup completes");
      }
      yield* Effect.orDie(startup.awaitCommandReady);
      return yield* httpEffect;
    }),
  { global: true },
);

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

const isLoopbackHostname = (hostname: string) =>
  LOOPBACK_HOSTNAMES.has(hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1"));

/**
 * The interface. In development Vite serves it, so the server sends the
 * browser there, except for the paths Vite passes back to the server.
 */
export const layerStaticAndDevRoute = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const devUrl = config.devUrl;
    if (devUrl !== undefined) {
      return HttpRouter.add(
        "GET",
        "*",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const url = HttpServerRequest.toURL(request);
          if (Option.isNone(url) || isDevProxiedPath(url.value.pathname)) {
            return HttpServerResponse.text("Not Found", { status: 404 });
          }
          if (!isLoopbackHostname(url.value.hostname)) {
            return HttpServerResponse.text("Not Found", { status: 404 });
          }
          const target = new URL(devUrl.toString());
          target.pathname = url.value.pathname;
          target.search = url.value.search;
          return HttpServerResponse.redirect(target.toString(), { status: 302 });
        }),
      );
    }
    if (config.staticDir === undefined) {
      return HttpRouter.add(
        "GET",
        "*",
        Effect.succeed(
          HttpServerResponse.text("The interface has not been built.", { status: 503 }),
        ),
      );
    }
    const serveStatic = yield* HttpStaticServer.make({ root: config.staticDir, spa: true });
    return HttpRouter.add(
      "GET",
      "*",
      serveStatic.pipe(Effect.catch(HttpServerRespondable.toResponse)),
    );
  }),
);

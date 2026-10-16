import { WS_METHODS, WsRpcGroup } from "@playstead/contracts/rpc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerRespondable from "effect/http/HttpServerRespondable";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";

import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import { failEnvironmentAuthInvalid, failEnvironmentInternal } from "./auth/http.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";

// RpcServer's default sends a socket-level Defect frame instead, and the client
// ends every pending request on the socket with it.
const WS_RPC_SERVER_OPTIONS = {
  disableTracing: true,
  disableFatalDefects: true,
} as const;

/** The RPC methods. Each is a thin call into a server service. */
const layerWsRpc = WsRpcGroup.toLayer(
  Effect.gen(function* () {
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;
    return WsRpcGroup.of({
      [WS_METHODS.serverGetConfig]: () =>
        Effect.map(environment.getDescriptor, (descriptor) => ({
          environment: descriptor,
          auth: auth.descriptor,
        })),
      [WS_METHODS.subscribeServerLifecycle]: () => lifecycleEvents.subscribe,
    });
  }),
);

/**
 * `/ws`: the RPC contract over one WebSocket. The upgrade needs a valid
 * short-lived ticket or the browser's session cookie; anything else is
 * refused with 401 before the socket opens.
 */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const handlers = yield* Layer.build(
      layerWsRpc.pipe(Layer.provideMerge(RpcSerialization.layerJson)),
    );
    return HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        yield* auth.authenticateWebSocketUpgrade(request).pipe(
          Effect.catchTags({
            ServerAuthCredentialError: failEnvironmentAuthInvalid,
            ServerAuthInternalError: (error) => failEnvironmentInternal("internal_error", error),
          }),
        );
        const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
        yield* RpcServer.make(WsRpcGroup, WS_RPC_SERVER_OPTIONS).pipe(
          Effect.provideService(RpcServer.Protocol, protocol),
          Effect.forkScoped,
        );
        return yield* httpEffect;
      }).pipe(
        Effect.provideContext(handlers),
        Effect.catchTags({
          EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
          EnvironmentInternalError: HttpServerRespondable.toResponse,
        }),
      ),
    );
  }),
);

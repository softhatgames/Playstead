import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { ServerConfig, ServerLifecycleStreamEvent } from "./server.ts";

export const WS_METHODS = {
  serverGetConfig: "server.getConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
} as const;

const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
});

const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  stream: true,
});

/**
 * The RPC contract on `/ws`. The socket is authenticated before it opens, and
 * every client on this computer may call every method, so the methods carry
 * no authorization middleware.
 */
export const WsRpcGroup = RpcGroup.make(WsServerGetConfigRpc, WsSubscribeServerLifecycleRpc);

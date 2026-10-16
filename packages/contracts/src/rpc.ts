import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { ProviderInstanceId, ProviderInstanceMutation } from "./providerInstance.ts";
import {
  ServerConfig,
  ServerConfigStreamEvent,
  ServerLifecycleStreamEvent,
  ServerProviderUpdatedPayload,
} from "./server.ts";
import { ServerSettings, ServerSettingsError } from "./settings.ts";

export const WS_METHODS = {
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpdateSettings: "server.updateSettings",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
} as const;

const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
});

/** Re-runs discovery for one instance, or both, without restarting the server. */
const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({ instanceId: Schema.optionalKey(ProviderInstanceId) }),
  success: ServerProviderUpdatedPayload,
});

/** Sets a provider instance's **Binary path**; the instance is checked again with it. */
const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ providerInstanceMutation: ProviderInstanceMutation }),
  success: ServerSettings,
  error: ServerSettingsError,
});

/** The config, then each change to provider statuses or settings. */
const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  stream: true,
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
export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpdateSettingsRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
);

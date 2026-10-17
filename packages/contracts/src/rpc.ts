import { ModelSelection } from "./orchestrationV2.ts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  FilesystemBrowseError,
  FilesystemBrowseInput,
  FilesystemBrowseResult,
} from "./filesystem.ts";
import {
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationThreadNotFoundError,
  OrchestrationV2ArchivedShellSnapshot,
  OrchestrationV2ArchivedShellStreamItem,
  OrchestrationV2Command,
  OrchestrationV2DispatchCommandResult,
  OrchestrationV2ShellStreamItem,
  OrchestrationV2SubscribeThreadInput,
  OrchestrationV2ThreadStreamItem,
} from "./orchestrationV2.ts";
import { Project, ProjectConflictError, ProjectMutation, ProjectMutationError } from "./project.ts";
import { ProviderInstanceId, ProviderInstanceMutation } from "./providerInstance.ts";
import {
  ServerConfig,
  ServerConfigStreamEvent,
  ServerLifecycleStreamEvent,
  ServerProviderUpdatedPayload,
} from "./server.ts";
import { ServerSettings, ServerSettingsError } from "./settings.ts";

import {
  OrchestrationSearchThreadsInput,
  OrchestrationSearchThreadsResult,
  OrchestrationSearchThreadsError,
} from "./threadSearch.ts";

export const WS_METHODS = {
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpdateSettings: "server.updateSettings",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  projectsMutate: "projects.mutate",
  filesystemBrowse: "filesystem.browse",
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
  payload: Schema.Union([
    Schema.Struct({ providerInstanceMutation: ProviderInstanceMutation }),
    Schema.Struct({ textGenerationModelSelection: ModelSelection }),
  ]),
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

/** Adds a folder as a project; the only mutation so far is `project.create`. */
const WsProjectsMutateRpc = Rpc.make(WS_METHODS.projectsMutate, {
  payload: ProjectMutation,
  success: Project,
  error: Schema.Union([ProjectMutationError, ProjectConflictError]),
});

/** The folders under a partly typed path, for Add project's autocompletion. */
const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: FilesystemBrowseError,
});

/** The sidebar's shell: a snapshot, then each change. */
const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.subscribeShell, {
  payload: Schema.Struct({}),
  success: OrchestrationV2ShellStreamItem,
  stream: true,
});

/** **Settings → Archive**'s threads as they are now. */
const WsOrchestrationGetArchivedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot,
  { payload: Schema.Struct({}), success: OrchestrationV2ArchivedShellSnapshot },
);

/** **Settings → Archive**'s threads: a snapshot, then each change. */
const WsOrchestrationSubscribeArchivedShellRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.subscribeArchivedShell,
  { payload: Schema.Struct({}), success: OrchestrationV2ArchivedShellStreamItem, stream: true },
);

/** Sends an orchestration command; the result is the last event it produced. */
const WsOrchestrationDispatchCommandRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
  payload: OrchestrationV2Command,
  success: OrchestrationV2DispatchCommandResult,
  error: OrchestrationDispatchCommandError,
});

/** One thread for the thread view: its projection, then each of its events. */
const WsOrchestrationSubscribeThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.subscribeThread, {
  payload: OrchestrationV2SubscribeThreadInput,
  success: OrchestrationV2ThreadStreamItem,
  error: OrchestrationThreadNotFoundError,
  stream: true,
});

const WsOrchestrationSearchThreadsRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.searchThreads, {
  payload: OrchestrationSearchThreadsInput,
  success: OrchestrationSearchThreadsResult,
  error: OrchestrationSearchThreadsError,
});

/**
 * The RPC contract on `/ws`. The socket is authenticated before it opens, and
 * every client on this computer may call every method, so the methods carry
 * no authorization middleware.
 */
export const WsRpcGroup = RpcGroup.make(
  WsOrchestrationSearchThreadsRpc,
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpdateSettingsRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsProjectsMutateRpc,
  WsFilesystemBrowseRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationSubscribeArchivedShellRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationSubscribeThreadRpc,
);

import {
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationDispatchCommandError,
} from "@playstead/contracts/orchestrationV2";
import { ProjectMutationError } from "@playstead/contracts/project";
import { WS_METHODS, WsRpcGroup } from "@playstead/contracts/rpc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerRespondable from "effect/http/HttpServerRespondable";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";

import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import { failEnvironmentAuthInvalid, failEnvironmentInternal } from "./auth/http.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import {
  getArchivedShellSnapshot,
  streamArchivedShell,
  streamShell,
} from "./orchestration-v2/ShellStream.ts";
import { streamThread } from "./orchestration-v2/ThreadStream.ts";
import * as ProjectService from "./project/ProjectService.ts";
import * as ProviderRegistry from "./provider/ProviderRegistry.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as WorkspaceEntries from "./workspace/WorkspaceEntries.ts";

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
    const providers = yield* ProviderRegistry.ProviderRegistry;
    const settings = yield* ServerSettings.ServerSettingsService;
    const projects = yield* ProjectService.ProjectService;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const context = yield* Effect.context<
      | Effect.Services<typeof streamShell>
      | Stream.Services<ReturnType<typeof streamThread>>
      | Path.Path
    >();
    const getConfig = Effect.all({
      environment: environment.getDescriptor,
      auth: Effect.succeed(auth.descriptor),
      providers: providers.getProviders,
      settings: settings.getSettings,
    });
    return WsRpcGroup.of({
      [WS_METHODS.serverGetConfig]: () => getConfig,
      [WS_METHODS.serverRefreshProviders]: ({ instanceId }) =>
        Effect.map(providers.refresh(instanceId), (list) => ({ providers: list })),
      [WS_METHODS.serverUpdateSettings]: ({ patch, providerInstanceMutation }) =>
        providerInstanceMutation === undefined
          ? settings.updateSettings(patch)
          : settings.updateProviderInstance(providerInstanceMutation, patch),
      // Both change streams start with their current value, which the
      // snapshot already carries.
      [WS_METHODS.subscribeServerConfig]: () =>
        Stream.concat(
          Stream.fromEffect(
            Effect.map(getConfig, (config) => ({
              version: 1 as const,
              type: "snapshot" as const,
              config,
            })),
          ),
          Stream.merge(
            providers.streamChanges.pipe(
              Stream.drop(1),
              Stream.map((list) => ({
                version: 1 as const,
                type: "providerStatuses" as const,
                payload: { providers: list },
              })),
            ),
            settings.streamChanges.pipe(
              Stream.drop(1),
              Stream.map((next) => ({
                version: 1 as const,
                type: "settingsUpdated" as const,
                payload: { settings: next },
              })),
            ),
          ),
        ),
      [WS_METHODS.subscribeServerLifecycle]: () => lifecycleEvents.subscribe,
      // T3 Code's `projectMutationOperation` (`project/ProjectMutation.ts`).
      // A conflict passes through so the client can open the project that owns
      // the folder. Anything else is T3 Code's one mutation error, carrying
      // "Project X is not empty." or the folder check's reason when that is
      // what failed.
      [WS_METHODS.projectsMutate]: (mutation) =>
        (mutation.type === "project.create"
          ? projects.create(mutation)
          : mutation.type === "project.update"
            ? projects.update(mutation)
            : projects.delete(mutation)
        ).pipe(
          Effect.catchTags({
            ProjectNotFoundError: (cause) =>
              Effect.fail(
                new ProjectMutationError({
                  commandId: mutation.commandId,
                  message: "Failed to mutate project.",
                  cause,
                }),
              ),
            ProjectNotEmptyError: (cause) =>
              Effect.fail(
                new ProjectMutationError({
                  commandId: mutation.commandId,
                  message: cause.message,
                  cause,
                }),
              ),
            ProjectOperationError: (cause) =>
              Effect.fail(
                new ProjectMutationError({
                  commandId: mutation.commandId,
                  message:
                    cause.operation === "normalize-workspace" && cause.cause instanceof Error
                      ? cause.cause.message
                      : "Failed to mutate project.",
                  cause,
                }),
              ),
          }),
        ),
      [WS_METHODS.filesystemBrowse]: (input) =>
        WorkspaceEntries.browse(input).pipe(Effect.provideContext(context)),
      [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: () =>
        streamShell.pipe(Stream.orDie, Stream.provideContext(context)),
      [ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot]: () =>
        getArchivedShellSnapshot.pipe(Effect.orDie, Effect.provideContext(context)),
      [ORCHESTRATION_V2_WS_METHODS.subscribeArchivedShell]: () =>
        streamArchivedShell.pipe(Stream.orDie, Stream.provideContext(context)),
      // Mutations reach here only after startup: `/ws` waits at the readiness gate.
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (command) =>
        orchestrator.dispatch(command).pipe(
          Effect.catchTag("OrchestratorDispatchError", (error) =>
            Effect.logWarning("An orchestration command could not be dispatched.").pipe(
              Effect.annotateLogs({ commandId: command.commandId, cause: String(error.cause) }),
              Effect.andThen(
                Effect.fail(
                  new OrchestrationDispatchCommandError({
                    commandId: command.commandId,
                    message: error.message,
                  }),
                ),
              ),
            ),
          ),
        ),
      [ORCHESTRATION_V2_WS_METHODS.subscribeThread]: ({ threadId }) =>
        streamThread(threadId).pipe(
          Stream.catchTags({
            EventStoreReadEventsError: Stream.die,
            ProjectionStoreV2Error: Stream.die,
            SqlError: Stream.die,
          }),
          Stream.provideContext(context),
        ),
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

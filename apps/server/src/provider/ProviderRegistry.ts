import type { ProviderTextGeneration } from "@playstead/provider-core/server/textGeneration";
import {
  PROVIDER_INSTANCE_IDS,
  type ProviderInstanceId,
  type ProviderInstanceSettings,
} from "@playstead/contracts/providerInstance";
import type { ServerProvider, ServerProviders } from "@playstead/contracts/server";
import type { ServerSettings } from "@playstead/contracts/settings";
import type { ProviderDriver, ProviderInstance } from "@playstead/provider-core/server/driver";
import type { ProviderAdapterV2 } from "@playstead/provider-core/server/ProviderAdapter";
import * as HostProcess from "@playstead/shared/hostProcess";
import { type ProcessEnvironment, withKnownCliDirs } from "@playstead/shared/shell";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import { ClaudeDriver } from "./Drivers/ClaudeDriver.ts";
import { CodexDriver } from "./Drivers/CodexDriver.ts";
import { applyProviderCompatibility } from "./providerCompatibility.ts";

/**
 * The provider instances and their statuses, following T3 Code's
 * `ProviderInstanceRegistry` and `ProviderRegistry`
 * (`apps/server/src/provider/` at 2577baf), merged into one service since
 * there are only the two built-in instances.
 *
 * Each instance is built from its settings. A changed **Binary path** closes
 * the instance and builds a new one, which checks the provider again; nothing
 * restarts. Every snapshot gets the compatibility advisory.
 */
export class ProviderRegistry extends Context.Service<
  ProviderRegistry,
  {
    readonly getTextGeneration: (
      instanceId: ProviderInstanceId,
    ) => Effect.Effect<Option.Option<ProviderTextGeneration>>;
    readonly getProviders: Effect.Effect<ServerProviders>;
    /** Checks one instance, or both, again and returns every status. */
    readonly refresh: (instanceId?: ProviderInstanceId) => Effect.Effect<ServerProviders>;
    /** Every status now, then after each change. */
    readonly streamChanges: Stream.Stream<ServerProviders>;
    /** The instance's current orchestration adapter, if it can run threads. */
    readonly getAdapter: (
      instanceId: ProviderInstanceId,
    ) => Effect.Effect<Option.Option<ProviderAdapterV2>>;
  }
>()("@playstead/server/provider/ProviderRegistry") {}

const BUILT_IN_DRIVERS: Record<
  ProviderInstanceId,
  ProviderDriver<ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Crypto.Crypto>
> = {
  codex: CodexDriver,
  claudeAgent: ClaudeDriver,
};

interface LiveInstance {
  readonly settings: ProviderInstanceSettings;
  readonly instance: ProviderInstance;
  readonly scope: Scope.Closeable;
}

const instanceSettings = (settings: ServerSettings, instanceId: ProviderInstanceId) =>
  settings.providerInstances[instanceId]?.config ?? {};

/**
 * The environment Codex and Claude are started with, and pass on to every
 * program they start: the server's, as in T3 Code, without
 * `ELECTRON_RUN_AS_NODE`. The desktop app sets it to run the server on
 * Electron's Node, and an agent that inherits it starts any Electron app,
 * a game included, as plain Node. A deliberate departure from T3 Code at
 * 2577baf, which passes it to Codex and Claude. Windows variable names are
 * case-insensitive, so the match is too.
 */
const providerEnvironment = (environment: ProcessEnvironment): ProcessEnvironment =>
  Object.fromEntries(
    Object.entries(environment).filter(([name]) => name.toUpperCase() !== "ELECTRON_RUN_AS_NODE"),
  );

const sameSettings = (left: ProviderInstanceSettings, right: ProviderInstanceSettings) =>
  left.binaryPath === right.binaryPath;

export const layer = Layer.effect(
  ProviderRegistry,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const settingsService = yield* ServerSettingsService.ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fileSystem = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;
    const platform = yield* HostProcess.Platform;
    const homeDirectory = yield* HostProcess.HomeDirectory;
    const environment = withKnownCliDirs({
      platform,
      env: providerEnvironment(yield* HostProcess.Environment),
    });
    const registryScope = yield* Effect.scope;

    const live = new Map<ProviderInstanceId, LiveInstance>();
    const statuses = yield* SubscriptionRef.make<
      Partial<Record<ProviderInstanceId, ServerProvider>>
    >({});
    const reconciling = yield* Semaphore.make(1);

    const publish = (snapshot: ServerProvider) =>
      SubscriptionRef.update(statuses, (current) => ({
        ...current,
        [snapshot.instanceId]: applyProviderCompatibility(snapshot),
      }));

    const toList = (current: Partial<Record<ProviderInstanceId, ServerProvider>>) =>
      PROVIDER_INSTANCE_IDS.flatMap((id) => (current[id] === undefined ? [] : [current[id]]));

    const build = (instanceId: ProviderInstanceId, settings: ProviderInstanceSettings) =>
      Effect.gen(function* () {
        const scope = yield* Scope.fork(registryScope);
        const instance = yield* BUILT_IN_DRIVERS[instanceId]
          .create({ instanceId, settings, environment, platform, homeDirectory, cwd: config.cwd })
          .pipe(
            Scope.provide(scope),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Crypto.Crypto, crypto),
          );
        yield* publish(yield* instance.snapshot.getSnapshot);
        yield* Stream.runForEach(instance.snapshot.streamChanges, publish).pipe(
          Effect.forkIn(scope),
        );
        live.set(instanceId, { settings, instance, scope });
      });

    const reconcile = (settings: ServerSettings) =>
      Effect.forEach(PROVIDER_INSTANCE_IDS, (instanceId) =>
        Effect.gen(function* () {
          const next = instanceSettings(settings, instanceId);
          const current = live.get(instanceId);
          if (current !== undefined && sameSettings(current.settings, next)) return;
          if (current !== undefined) yield* Scope.close(current.scope, Exit.void);
          yield* build(instanceId, next);
        }),
      ).pipe(reconciling.withPermit);

    yield* reconcile(yield* settingsService.getSettings);
    yield* Stream.runForEach(settingsService.streamChanges, reconcile).pipe(Effect.forkScoped);

    const getProviders = Effect.map(SubscriptionRef.get(statuses), toList);

    return ProviderRegistry.of({
      getProviders,
      getTextGeneration: (instanceId) =>
        Effect.sync(() => Option.fromUndefinedOr(live.get(instanceId)?.instance.textGeneration)),
      refresh: (instanceId) =>
        Effect.gen(function* () {
          const ids = instanceId === undefined ? PROVIDER_INSTANCE_IDS : [instanceId];
          // Settings may be changing the instance; refresh the one that results.
          const instances = yield* Effect.sync(() =>
            ids.flatMap((id) => {
              const entry = live.get(id);
              return entry === undefined ? [] : [entry.instance];
            }),
          ).pipe(reconciling.withPermit);
          yield* Effect.forEach(
            instances,
            (instance) =>
              Effect.flatMap(instance.snapshot.refresh, (snapshot) =>
                // An instance replaced while it was being checked reports nothing.
                live.get(instance.instanceId)?.instance === instance
                  ? publish(snapshot)
                  : Effect.void,
              ),
            { concurrency: "unbounded" },
          );
          return yield* getProviders;
        }),
      streamChanges: SubscriptionRef.changes(statuses).pipe(Stream.map(toList)),
      getAdapter: (instanceId) =>
        Effect.sync(() =>
          Option.fromUndefinedOr(live.get(instanceId)?.instance.orchestrationAdapter),
        ),
    });
  }),
);

import type { ThreadId } from "@playstead/contracts/baseSchemas";
import { ACTIVE_RUN_STATUSES, type OrchestrationV2Run } from "@playstead/contracts/orchestrationV2";
import * as HostProcess from "@playstead/shared/hostProcess";
import type { ProcessEnvironment } from "@playstead/shared/shell";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import { makeTestServerConfig } from "../../testUtils/testServer.ts";
import * as WorkspacePaths from "../../workspace/WorkspacePaths.ts";
import { ClaudeAgentSdkQueryRunner, makeClaudeAdapter } from "../Adapters/ClaudeAdapterV2.ts";
import { CodexAppServerClientFactory, makeCodexAdapter } from "../Adapters/CodexAdapterV2.ts";
import * as EffectWorker from "../EffectWorker.ts";
import * as EventStore from "../EventStore.ts";
import * as Orchestrator from "../Orchestrator.ts";
import * as ProviderAdapterRegistry from "../ProviderAdapterRegistry.ts";
import * as ProviderRuntimeRecoveryService from "../ProviderRuntimeRecoveryService.ts";
import * as OrchestrationRuntime from "../runtimeLayer.ts";

import { ThreadSearch } from "../ThreadSearch.ts";

/**
 * Seam 1: the real server services at the orchestrator's command boundary
 * (T3 Code's `ProviderReplayHarness.ts` `layerWithRegistry` at 2577baf,
 * without checkpoints, Git or handoffs). The orchestrator, event sink,
 * effect worker, provider adapters, projections, project service and SQLite
 * are real, in a temporary Playstead home; only each adapter's seam to its
 * provider is given (Claude's `query()` runner, Codex's app-server clients):
 * a replay in tests, the recording wrapper in the recorders. A provider
 * given no seam has no adapter, so it cannot run threads. A restart is a
 * second harness over the first one's `config`.
 */
export const makeOrchestrationHarness = Effect.fn("makeOrchestrationHarness")(function* (input: {
  readonly claudeRunner?: ClaudeAgentSdkQueryRunner["Service"];
  readonly codexClients?: CodexAppServerClientFactory["Service"];
  /** The recorders run the person's CLI with their environment; replays need neither. */
  readonly claudeBinaryPath?: string;
  readonly codexBinaryPath?: string;
  readonly environment?: ProcessEnvironment;
  /**
   * An existing Playstead home, to build the services again over its SQLite
   * file as a restarted server would. By default a new temporary home.
   */
  readonly config?: ServerConfig.ServerConfig["Service"];
  /** Runs startup recovery before anything is dispatched, as the server's startup does. */
  readonly recoverOnStartup?: boolean;
}) {
  const config = input.config ?? (yield* makeTestServerConfig());
  const platform = yield* HostProcess.Platform;
  const environment = input.environment ?? {};
  const claude =
    input.claudeRunner === undefined
      ? Effect.succeed([])
      : makeClaudeAdapter({
          instanceId: "claudeAgent",
          binaryPath: input.claudeBinaryPath ?? "claude",
          environment,
          platform,
        }).pipe(
          Effect.provideService(ClaudeAgentSdkQueryRunner, input.claudeRunner),
          Effect.map((adapter) => [adapter]),
        );
  const codex =
    input.codexClients === undefined
      ? Effect.succeed([])
      : makeCodexAdapter({
          instanceId: "codex",
          binaryPath: input.codexBinaryPath ?? "codex",
          environment,
          platform,
          cwd: config.baseDir,
        }).pipe(
          Effect.provideService(CodexAppServerClientFactory, input.codexClients),
          Effect.map((adapter) => [adapter]),
        );
  const adapters = Layer.unwrap(
    Effect.map(Effect.all([claude, codex]), (lists) =>
      ProviderAdapterRegistry.layerFromAdapters(lists.flat()),
    ),
  );
  const context = yield* Layer.build(
    Layer.mergeAll(
      OrchestrationRuntime.layerCore,
      ProjectService.layer,
      ProviderRuntimeRecoveryService.layer,
    ).pipe(
      Layer.provide(adapters),
      Layer.provideMerge(OrchestrationRuntime.layer),
      Layer.provide(WorkspacePaths.layer),
      Layer.provide(SqlitePersistence.layerConfig),
      Layer.provide(ServerConfig.layer(config)),
    ),
  );
  const services = yield* Effect.all({
    search: ThreadSearch,
    orchestrator: Orchestrator.OrchestratorV2,
    worker: EffectWorker.OrchestrationEffectWorkerV2,
    projects: ProjectService.ProjectService,
    eventStore: EventStore.EventStoreV2,
    recovery: ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService,
  }).pipe(Effect.provideContext(context));
  if (input.recoverOnStartup === true) yield* services.recovery.recover;

  /**
   * Waits, without sleeping, for the thread's run to end: reads the thread's
   * events after `afterSequence` until a run update leaves no run active.
   */
  const awaitRunEnded = (threadId: ThreadId, afterSequence: number) =>
    services.eventStore.streamApplicationEvents({ afterSequence }).pipe(
      Stream.map((stored): OrchestrationV2Run | undefined =>
        stored.aggregateKind === "thread" &&
        stored.event.threadId === threadId &&
        stored.event.type === "run.updated" &&
        !ACTIVE_RUN_STATUSES.has(stored.event.payload.status)
          ? stored.event.payload
          : undefined,
      ),
      Stream.filter((run) => run !== undefined),
      Stream.runHead,
      Effect.flatMap((run) =>
        run._tag === "Some"
          ? Effect.succeed(run.value)
          : Effect.die("The event stream ended before the run did."),
      ),
    );

  return { ...services, home: config.baseDir, awaitRunEnded };
});

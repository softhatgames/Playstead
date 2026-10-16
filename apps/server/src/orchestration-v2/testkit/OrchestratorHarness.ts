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
import * as EffectWorker from "../EffectWorker.ts";
import * as EventStore from "../EventStore.ts";
import * as Orchestrator from "../Orchestrator.ts";
import * as ProviderAdapterRegistry from "../ProviderAdapterRegistry.ts";
import * as OrchestrationRuntime from "../runtimeLayer.ts";

/**
 * Seam 1: the real server services at the orchestrator's command boundary
 * (T3 Code's `ProviderReplayHarness.ts` `layerWithRegistry` at 2577baf,
 * without checkpoints, Git or handoffs). The orchestrator, event sink,
 * effect worker, Claude adapter, projections, project service and SQLite
 * are real, in a temporary Playstead home; only the adapter's `query()`
 * runner is given: a replay in tests, the recording wrapper in the recorder.
 */
export const makeOrchestrationHarness = Effect.fn("makeOrchestrationHarness")(function* (input: {
  readonly claudeRunner: ClaudeAgentSdkQueryRunner["Service"];
  /** The recorder runs the person's `claude` with their environment; replays need neither. */
  readonly claudeBinaryPath?: string;
  readonly environment?: ProcessEnvironment;
}) {
  const config = yield* makeTestServerConfig();
  const platform = yield* HostProcess.Platform;
  const adapters = Layer.unwrap(
    makeClaudeAdapter({
      instanceId: "claudeAgent",
      binaryPath: input.claudeBinaryPath ?? "claude",
      environment: input.environment ?? {},
      platform,
    }).pipe(
      Effect.provideService(ClaudeAgentSdkQueryRunner, input.claudeRunner),
      Effect.map((claude) => ProviderAdapterRegistry.layerFromAdapters([claude])),
    ),
  );
  const context = yield* Layer.build(
    Layer.mergeAll(OrchestrationRuntime.layerCore, ProjectService.layer).pipe(
      Layer.provide(adapters),
      Layer.provideMerge(OrchestrationRuntime.layer),
      Layer.provide(WorkspacePaths.layer),
      Layer.provide(SqlitePersistence.layerConfig),
      Layer.provide(ServerConfig.layer(config)),
    ),
  );
  const services = yield* Effect.all({
    orchestrator: Orchestrator.OrchestratorV2,
    worker: EffectWorker.OrchestrationEffectWorkerV2,
    projects: ProjectService.ProjectService,
    eventStore: EventStore.EventStoreV2,
  }).pipe(Effect.provideContext(context));

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

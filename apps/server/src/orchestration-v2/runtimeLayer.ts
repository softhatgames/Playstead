import * as Layer from "effect/Layer";

import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as ProviderTurnStartService from "./ProviderTurnStartService.ts";
import * as RunExecutionService from "./RunExecutionService.ts";
import * as ThreadSettlementService from "./ThreadSettlementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ThreadSearch from "./ThreadSearch.ts";
import * as ThreadTitleRegenerationService from "./ThreadTitleRegenerationService.ts";

/**
 * Orchestration's stores, event sink and thread search over the server's SQLite, assembled
 * once for the server and its tests (T3 Code's
 * `apps/server/src/orchestration-v2/runtimeLayer.ts` at 2577baf). The sink
 * and the stream readers must share one event store, whose publishing is in
 * memory. The managed project folders (threads without a project) sit
 * beside them: the orchestrator and the project service both read them.
 */
export const layer = Layer.mergeAll(EventSink.layer, ManagedProjectFolders.layer).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      CommandReceiptStore.layer,
      EventStore.layer,
      ProjectStore.layer,
      ProjectionStore.layer,
      EffectOutbox.layer,
      ThreadSearch.layer,
    ),
  ),
);

/**
 * The orchestrator, the effect worker and automatic settlement, with what
 * starts and runs provider turns and generates titles. They need the stores above, a
 * `ProviderAdapterRegistryV2`, the server's settings and `TextGeneration`:
 * the server's read the provider registry, and tests give replaying
 * adapters and their own text generation.
 */
export const layerCore = Layer.mergeAll(EffectWorker.layer, ThreadSettlementService.layer).pipe(
  Layer.provide(ThreadTitleRegenerationService.layer),
  // A steer that comes too late dispatches its message again.
  Layer.provideMerge(Orchestrator.layer),
  Layer.provide(ProviderTurnStartService.layer),
  Layer.provide(Layer.mergeAll(RunExecutionService.layer, ProviderSessionManager.layer)),
);

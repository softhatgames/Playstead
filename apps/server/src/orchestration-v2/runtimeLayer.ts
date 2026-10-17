import * as Settlement from "./ThreadSettlementService.ts";
import * as ThreadTitles from "./ThreadTitleRegenerationService.ts";
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

/**
 * Orchestration's stores and event sink over the server's SQLite, assembled
 * once for the server and its tests (T3 Code's
 * `apps/server/src/orchestration-v2/runtimeLayer.ts` at 2577baf). The sink
 * and the stream readers must share one event store, whose publishing is in
 * memory.
 */
export const layer = EventSink.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      CommandReceiptStore.layer,
      EventStore.layer,
      ProjectStore.layer,
      ProjectionStore.layer,
      EffectOutbox.layer,
    ),
  ),
);

/**
 * The orchestrator and the effect worker, with what starts and runs provider
 * turns. They need the stores above and a `ProviderAdapterRegistryV2`: the
 * server's reads the provider registry, and tests give replaying adapters.
 */
export const layerCore = Layer.mergeAll(EffectWorker.layer, Settlement.layer).pipe(
  Layer.provide(ThreadTitles.layer),
  Layer.provideMerge(Orchestrator.layer),
  Layer.provide(ProviderTurnStartService.layer),
  Layer.provide(Layer.mergeAll(RunExecutionService.layer, ProviderSessionManager.layer)),
);

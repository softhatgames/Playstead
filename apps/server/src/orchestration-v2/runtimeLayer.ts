import * as Layer from "effect/Layer";

import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectStore from "./ProjectStore.ts";

/**
 * Orchestration's stores and event sink over the server's SQLite, assembled
 * once for the server and its tests (T3 Code's
 * `apps/server/src/orchestration-v2/runtimeLayer.ts` at 2577baf). The sink
 * and the stream readers must share one event store, whose publishing is in
 * memory.
 */
export const layer = EventSink.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(CommandReceiptStore.layer, EventStore.layer, ProjectStore.layer),
  ),
);

import { CommandId } from "@playstead/contracts/baseSchemas";
import { ACTIVE_RUN_STATUSES } from "@playstead/contracts/orchestrationV2";
import { settlementAt } from "./ThreadSettlementPolicy.ts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ServerSettings from "../serverSettings.ts";
import * as EventStore from "./EventStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export class ThreadSettlementService extends Context.Service<
  ThreadSettlementService,
  {
    readonly start: Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("@playstead/server/orchestration-v2/ThreadSettlementService") {}

export const layer = Layer.effect(
  ThreadSettlementService,
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const events = yield* EventStore.EventStoreV2;
    const settings = yield* ServerSettings.ServerSettingsService;
    const crypto = yield* Crypto.Crypto;
    const lock = yield* Semaphore.make(1);
    const sweep = Effect.gen(function* () {
      if ((yield* settings.getSettings).sidebarAutoSettleAfterDays === null) return;
      for (const shell of yield* projections.listThreadShells("active")) {
        const current = yield* projections.getThread(shell.id);
        if (Option.isNone(current)) continue;
        const saved = (yield* settings.getSettings).sidebarAutoSettleAfterDays;
        const days = saved === undefined ? 3 : saved;
        const at = settlementAt(current.value, DateTime.toEpochMillis(yield* DateTime.now), days);
        if (at === null) continue;
        yield* orchestrator
          .dispatch({
            type: "thread.auto-settle",
            commandId: CommandId.make(`auto-settle:${yield* crypto.randomUUIDv4()}`),
            threadId: shell.id,
            snapshotAt: current.value.thread.updatedAt,
            settledAt: at,
          })
          .pipe(
            Effect.catch((error) => Effect.logWarning("Automatic settlement skipped", { error })),
          );
      }
    }).pipe(
      lock.withPermit,
      Effect.catch((error) => Effect.logWarning("Automatic settlement sweep failed", { error })),
    );
    const start = Effect.gen(function* () {
      const sequence = yield* events.latestApplicationSequence.pipe(Effect.orDie);
      yield* sweep;
      yield* Effect.sleep("1 minute").pipe(
        Effect.andThen(sweep),
        Effect.forever,
        Effect.forkScoped,
      );
      yield* settings.streamChanges.pipe(
        Stream.changesWith((a, b) => a.sidebarAutoSettleAfterDays === b.sidebarAutoSettleAfterDays),
        Stream.runForEach(() => sweep),
        Effect.forkScoped,
      );
      yield* events.streamApplicationEvents({ afterSequence: sequence }).pipe(
        Stream.runForEach((stored) => {
          if (stored.aggregateKind !== "thread") return Effect.void;
          const event = stored.event;
          return (event.type === "run.updated" && !ACTIVE_RUN_STATUSES.has(event.payload.status)) ||
            (event.type === "provider-session.updated" &&
              event.payload.status !== "starting" &&
              event.payload.status !== "running")
            ? sweep
            : Effect.void;
        }),
        Effect.catch((error) => Effect.logWarning("Settlement event stream failed", { error })),
        Effect.forkScoped,
      );
    });
    return { start, drain: lock.withPermit(Effect.void) };
  }),
);

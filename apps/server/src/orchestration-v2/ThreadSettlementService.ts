import { CommandId, type ThreadId } from "@playstead/contracts/baseSchemas";
import { TERMINAL_RUN_STATUSES } from "@playstead/contracts/orchestrationV2";
import type { ServerSettings } from "@playstead/contracts/settings";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TxQueue from "effect/TxQueue";
import * as TxRef from "effect/TxRef";

import * as ServerSettingsService from "../serverSettings.ts";
import * as EventStore from "./EventStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

import {
  isAutoSettlementCandidate,
  resolveAutoSettlementAt,
  snoozeStateOf,
} from "./ThreadSettlementPolicy.ts";
type Candidate = ProjectionStore.ProjectionSettlementCandidate;

/**
 * Settles threads that have had no activity for **Settings → General →
 * Auto-settle after** days, following T3 Code's `ThreadSettlementServiceV2`
 * (`apps/server/src/orchestration-v2/ThreadSettlementService.ts` at 2577baf)
 * without its pull-request rules, terminals and settle scripts.
 *
 * `start` sweeps every thread once a minute and when the setting changes,
 * and sweeps one thread when its run ends or its provider session stops.
 * Each thread the sweep would settle gets the internal `thread.auto-settle`,
 * with the thread's `updatedAt` as it read it, so a thread that changed
 * since is left alone. Startup calls `start` after recovery. `drain` waits
 * for the sweeps asked for so far.
 */
export class ThreadSettlementService extends Context.Service<
  ThreadSettlementService,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("@playstead/server/orchestration-v2/ThreadSettlementService") {}

const settlementSettingsKey = (settings: ServerSettings) =>
  JSON.stringify([settings.sidebarAutoSettleAfterDays]);

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const eventStore = yield* EventStore.EventStoreV2;
  const settingsService = yield* ServerSettingsService.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;

  const settleThread = (thread: Candidate) =>
    Effect.gen(function* () {
      const { sidebarAutoSettleAfterDays } = yield* settingsService.getSettings;
      const settledAt = resolveAutoSettlementAt({
        thread,
        snooze: snoozeStateOf(thread.thread),
        nowMs: DateTime.toEpochMillis(yield* DateTime.now),
        autoSettleAfterDays: sidebarAutoSettleAfterDays,
      });
      if (settledAt === null) return;
      yield* orchestrator.dispatch({
        type: "thread.auto-settle",
        commandId: CommandId.make(
          `server:auto-settle:${thread.id}:${yield* crypto.randomUUIDv4()}`,
        ),
        threadId: thread.id,
        snapshotAt: thread.updatedAt,
        settledAt,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("Automatic thread settlement skipped a thread").pipe(
              Effect.annotateLogs({ threadId: thread.id, cause: Cause.pretty(cause) }),
            ),
      ),
    );

  const sweep = (threadId: ThreadId | undefined) =>
    Effect.gen(function* () {
      const settings = yield* settingsService.getSettings;
      if (settings.sidebarAutoSettleAfterDays === null) return;
      const threads = yield* projections.getSettlementCandidates(threadId);
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      const candidates = threads.filter((thread) =>
        isAutoSettlementCandidate(thread, snoozeStateOf(thread.thread), nowMs),
      );
      yield* Effect.forEach(candidates, settleThread, { concurrency: 8, discard: true });
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("The automatic thread settlement sweep failed").pipe(
              Effect.annotateLogs({ cause: Cause.pretty(cause) }),
            ),
      ),
    );

  // Sweeps run one at a time, in the order asked; `drain` waits until every
  // sweep asked for has run (T3 Code's `makeDrainableWorker`).
  const outstanding = yield* TxRef.make(0);
  const queue = yield* TxQueue.unbounded<ThreadId | undefined>();
  const enqueue = (threadId: ThreadId | undefined) =>
    TxQueue.offer(queue, threadId).pipe(
      Effect.tap((offered) => (offered ? TxRef.update(outstanding, (n) => n + 1) : Effect.void)),
      Effect.tx,
      Effect.asVoid,
    );
  const drain = TxRef.get(outstanding).pipe(
    Effect.flatMap((n) => (n > 0 ? Effect.txRetry : Effect.void)),
    Effect.tx,
  );
  const runSweeps = TxQueue.take(queue).pipe(
    Effect.flatMap((threadId) =>
      sweep(threadId).pipe(Effect.ensuring(TxRef.update(outstanding, (n) => n - 1))),
    ),
    Effect.forever,
  );

  const start = Effect.fn("ThreadSettlementService.start")(function* () {
    yield* Effect.addFinalizer(() =>
      TxQueue.clear(queue).pipe(
        Effect.flatMap((dropped) => TxRef.update(outstanding, (n) => n - dropped.length)),
        Effect.tx,
      ),
    );
    yield* Effect.forkScoped(runSweeps);

    yield* Effect.forkScoped(
      enqueue(undefined).pipe(Effect.andThen(drain), Effect.repeat(Schedule.spaced("1 minute"))),
    );

    let lastSettingsKey = settlementSettingsKey(yield* settingsService.getSettings);
    yield* Effect.forkScoped(
      Stream.runForEach(settingsService.streamChanges, (settings) => {
        const key = settlementSettingsKey(settings);
        if (key === lastSettingsKey) return Effect.void;
        lastSettingsKey = key;
        return enqueue(undefined);
      }),
    );

    const afterSequence = yield* eventStore.latestApplicationSequence.pipe(Effect.orDie);
    yield* Effect.forkScoped(
      Stream.runForEach(eventStore.streamApplicationEvents({ afterSequence }), (stored) => {
        if (stored.aggregateKind !== "thread") return Effect.void;
        const { event } = stored;
        switch (event.type) {
          case "run.updated":
            return TERMINAL_RUN_STATUSES.has(event.payload.status)
              ? enqueue(event.threadId)
              : Effect.void;
          case "provider-session.updated":
            return event.payload.status !== "starting" && event.payload.status !== "running"
              ? enqueue(event.threadId)
              : Effect.void;
          default:
            return Effect.void;
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Automatic thread settlement stopped following events").pipe(
            Effect.annotateLogs({ cause: Cause.pretty(cause) }),
          ),
        ),
      ),
    );
  });

  return ThreadSettlementService.of({ start, drain });
});

export const layer = Layer.effect(ThreadSettlementService, make);

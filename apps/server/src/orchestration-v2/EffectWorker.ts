import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as EffectOutbox from "./EffectOutbox.ts";
import * as ProviderTurnStartService from "./ProviderTurnStartService.ts";
import * as RunExecutionService from "./RunExecutionService.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/**
 * Runs the outbox's effects (T3 Code's
 * `apps/server/src/orchestration-v2/EffectWorker.ts` at 2577baf): starting a
 * run's provider turn, interrupting it, and giving it the person's answers;
 * there is no checkpoint step. An effect a command cancels while it runs is
 * stopped, as T3 Code's `runOnce` races `execute` against
 * `awaitCancellation`. The server runs `runDaemon`; tests call `drain` and
 * then wait for the events they expect.
 */
export class OrchestrationEffectWorkerV2 extends Context.Service<
  OrchestrationEffectWorkerV2,
  {
    /** Runs one claimable effect; false when there was none. */
    readonly runOnce: Effect.Effect<boolean, EffectOutbox.EffectOutboxError>;
    /** Runs effects until none is claimable, and says how many ran. */
    readonly drain: Effect.Effect<number, EffectOutbox.EffectOutboxError>;
    /** Drains, then waits for more, for as long as it runs. */
    readonly runDaemon: Effect.Effect<never, EffectOutbox.EffectOutboxError>;
  }
>()("@playstead/server/orchestration-v2/EffectWorker/OrchestrationEffectWorkerV2") {}

const make = Effect.gen(function* () {
  const outbox = yield* EffectOutbox.EffectOutboxV2;
  const turnStart = yield* ProviderTurnStartService.ProviderTurnStartServiceV2;
  const runs = yield* RunExecutionService.RunExecutionServiceV2;

  const execute = (
    effect: EffectOutbox.ClaimedEffect,
  ): Effect.Effect<
    void,
    | ProviderTurnStartService.ProviderTurnStartError
    | Effect.Error<ReturnType<RunExecutionService.RunExecutionServiceV2["Service"]["interruptRun"]>>
    | Effect.Error<
        ReturnType<RunExecutionService.RunExecutionServiceV2["Service"]["respondToRuntimeRequest"]>
      >
  > => {
    switch (effect.request.type) {
      case "provider-turn.start":
        return turnStart.start({ threadId: effect.threadId, runId: effect.request.runId });
      case "provider-turn.interrupt":
        return runs.interruptRun({
          threadId: effect.threadId,
          runId: effect.request.runId,
          providerTurnId: effect.request.providerTurnId,
        });
      case "runtime-request.respond":
        return runs.respondToRuntimeRequest({
          runId: effect.request.runId,
          providerSessionId: effect.request.providerSessionId,
          requestId: effect.request.requestId,
          ...(effect.request.decision === undefined ? {} : { decision: effect.request.decision }),
          ...(effect.request.answers === undefined ? {} : { answers: effect.request.answers }),
        });
    }
  };

  const runOnce = Effect.gen(function* () {
    const claimed = yield* outbox.claimNext(yield* nowIso);
    if (Option.isNone(claimed)) return false;
    const effect = claimed.value;
    const outcome = yield* Effect.raceFirst(
      Effect.exit(execute(effect)),
      Effect.as(outbox.awaitCancellation(effect.id), "cancelled" as const),
    ).pipe(Effect.scoped);
    if (outcome === "cancelled") {
      yield* Effect.logDebug("A cancelled orchestration effect was stopped.").pipe(
        Effect.annotateLogs({ effectId: effect.id, effectType: effect.request.type }),
      );
      return true;
    }
    const exit = outcome;
    if (exit._tag === "Success") {
      yield* outbox.succeed(effect.id, yield* nowIso);
    } else {
      yield* Effect.logWarning("An orchestration effect failed.").pipe(
        Effect.annotateLogs({ effectId: effect.id, effectType: effect.request.type }),
      );
      yield* outbox.fail(effect.id, String(exit.cause), yield* nowIso);
    }
    return true;
  });

  const drain = Effect.gen(function* () {
    let count = 0;
    while (yield* runOnce) count += 1;
    return count;
  });

  return OrchestrationEffectWorkerV2.of({
    runOnce,
    drain,
    runDaemon: Effect.forever(Effect.andThen(drain, outbox.awaitAvailable)),
  });
});

export const layer = Layer.effect(OrchestrationEffectWorkerV2, make);

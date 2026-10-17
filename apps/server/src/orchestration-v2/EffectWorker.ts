import * as ThreadTitleRegeneration from "./ThreadTitleRegenerationService.ts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as EffectOutbox from "./EffectOutbox.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as ProviderTurnStartService from "./ProviderTurnStartService.ts";
import * as RunExecutionService from "./RunExecutionService.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/**
 * Runs the outbox's effects (T3 Code's
 * `apps/server/src/orchestration-v2/EffectWorker.ts` at 2577baf): starting a
 * run's provider turn, interrupting it, giving it the person's answers, and
 * stopping a thread's provider session and generating its title; there is no checkpoint step. An effect a command cancels while it runs is
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
    /** Claims independent lanes concurrently, then waits for new work or a lane to finish. */
    readonly runDaemon: Effect.Effect<never, EffectOutbox.EffectOutboxError>;
  }
>()("@playstead/server/orchestration-v2/EffectWorker/OrchestrationEffectWorkerV2") {}

const make = Effect.gen(function* () {
  const outbox = yield* EffectOutbox.EffectOutboxV2;
  const turnStart = yield* ProviderTurnStartService.ProviderTurnStartServiceV2;
  const runs = yield* RunExecutionService.RunExecutionServiceV2;
  const titles = yield* ThreadTitleRegeneration.ThreadTitleRegenerationService;
  const workerScope = yield* Effect.scope;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;

  const execute = (
    effect: EffectOutbox.ClaimedEffect,
  ): Effect.Effect<
    void,
    | Effect.Error<
        ReturnType<ThreadTitleRegeneration.ThreadTitleRegenerationService["Service"]["execute"]>
      >
    | ProviderTurnStartService.ProviderTurnStartError
    | Effect.Error<ReturnType<RunExecutionService.RunExecutionServiceV2["Service"]["interruptRun"]>>
    | Effect.Error<
        ReturnType<RunExecutionService.RunExecutionServiceV2["Service"]["respondToRuntimeRequest"]>
      >
  > => {
    switch (effect.request.type) {
      case "thread-title.generate":
        return titles.execute({
          threadId: effect.threadId,
          requestId: effect.commandId,
          kind: effect.request.kind,
        });
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
          answers: effect.request.answers,
        });
      case "provider-session.detach":
        return sessions.detach({
          threadId: effect.threadId,
          providerSessionId: effect.request.providerSessionId,
        });
    }
  };

  const runClaimed = Effect.fn("EffectWorker.runClaimed")(function* (
    effect: EffectOutbox.ClaimedEffect,
  ) {
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

  const runOnce = Effect.gen(function* () {
    const claimed = yield* outbox.claimNext(yield* nowIso);
    return Option.isNone(claimed) ? false : yield* runClaimed(claimed.value);
  });
  const drain = Effect.gen(function* () {
    let count = 0;
    while (yield* runOnce) count += 1;
    return count;
  });

  return OrchestrationEffectWorkerV2.of({
    runOnce,
    drain,
    runDaemon: Effect.forever(
      Effect.gen(function* () {
        const claimed = yield* outbox.claimNext(yield* nowIso);
        if (Option.isNone(claimed)) {
          yield* outbox.awaitAvailable;
          return;
        }
        yield* runClaimed(claimed.value).pipe(
          Effect.ensuring(outbox.notifyAvailable),
          Effect.forkIn(workerScope),
        );
      }),
    ),
  });
});

export const layer = Layer.effect(OrchestrationEffectWorkerV2, make);

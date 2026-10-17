import { CommandId, type MessageId } from "@playstead/contracts/baseSchemas";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as EffectOutbox from "./EffectOutbox.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderTurnStartService from "./ProviderTurnStartService.ts";
import * as RunExecutionService from "./RunExecutionService.ts";
import * as ThreadTitleRegenerationService from "./ThreadTitleRegenerationService.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/** How many effects the server runs at once (T3 Code's `DEFAULT_EFFECT_WORKER_CONCURRENCY`). */
const DAEMON_CONCURRENCY = 4;

/**
 * Runs the outbox's effects (T3 Code's
 * `apps/server/src/orchestration-v2/EffectWorker.ts` at 2577baf): starting a
 * run's provider turn, interrupting it, steering it, giving it the person's
 * answers, stopping a thread's provider session and generating a thread's
 * title; there is no checkpoint step. A steer that finds its turn completed
 * starts a run with its message instead. An effect a command cancels while it runs is
 * stopped, as T3 Code's `runOnce` races `execute` against
 * `awaitCancellation`. The server runs `runDaemon`, which runs up to four
 * effects at once, as T3 Code's daemon does, so a title being generated
 * holds up no turn. Tests call `drain` and then wait for the events they
 * expect.
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
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const titles = yield* ThreadTitleRegenerationService.ThreadTitleRegenerationService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;

  /**
   * A steer that found its turn completed is sent again as a message that
   * starts a run (T3 Code's steer follow-up in `EffectWorker.ts`), with the
   * same message and a command id of its own, so a second try cannot start a
   * second run.
   */
  const steerFollowUp = (effect: EffectOutbox.ClaimedEffect, messageId: MessageId) =>
    Effect.gen(function* () {
      const projection = yield* orchestrator.getThreadProjection(effect.threadId);
      const message = Option.getOrUndefined(projection)?.messages.find(
        (candidate) => candidate.id === messageId,
      );
      if (message === undefined) return;
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`command:steer-follow-up:${effect.id}`),
        threadId: effect.threadId,
        messageId: message.id,
        text: message.text,
        dispatchMode: { type: "start_immediately" },
      });
    });

  const execute = (
    effect: EffectOutbox.ClaimedEffect,
  ): Effect.Effect<
    void,
    | ProviderTurnStartService.ProviderTurnStartError
    | Effect.Error<ReturnType<RunExecutionService.RunExecutionServiceV2["Service"]["interruptRun"]>>
    | Effect.Error<ReturnType<RunExecutionService.RunExecutionServiceV2["Service"]["steerRun"]>>
    | Effect.Error<ReturnType<Orchestrator.OrchestratorV2["Service"]["dispatch"]>>
    | Effect.Error<
        ReturnType<RunExecutionService.RunExecutionServiceV2["Service"]["respondToRuntimeRequest"]>
      >
    | Effect.Error<
        ReturnType<
          ThreadTitleRegenerationService.ThreadTitleRegenerationService["Service"]["execute"]
        >
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
      case "provider-turn.steer": {
        const request = effect.request;
        return runs
          .steerRun({
            threadId: effect.threadId,
            runId: request.runId,
            providerSessionId: request.providerSessionId,
            providerTurnId: request.providerTurnId,
            messageId: request.messageId,
          })
          .pipe(
            Effect.catchTag(
              "ProviderTurnSteerError",
              (
                error,
              ): Effect.Effect<
                void,
                | RunExecutionService.ProviderTurnSteerError
                | Effect.Error<ReturnType<typeof steerFollowUp>>
              > =>
                error.turnCompleted ? steerFollowUp(effect, request.messageId) : Effect.fail(error),
            ),
          );
      }
      case "runtime-request.respond":
        return runs.respondToRuntimeRequest({
          runId: effect.request.runId,
          providerSessionId: effect.request.providerSessionId,
          requestId: effect.request.requestId,
          ...(effect.request.decision === undefined ? {} : { decision: effect.request.decision }),
          ...(effect.request.answers === undefined ? {} : { answers: effect.request.answers }),
        });
      case "provider-session.detach":
        return sessions.detach({
          threadId: effect.threadId,
          providerSessionId: effect.request.providerSessionId,
        });
      case "thread-title.generate":
        return titles.execute({
          threadId: effect.threadId,
          requestId: effect.commandId,
          kind: effect.request.kind,
        });
    }
  };

  const runOnce = Effect.gen(function* () {
    const claimed = yield* outbox.claimNext(yield* nowIso);
    if (Option.isNone(claimed)) return false;
    const effect = claimed.value;
    // A command can leave several effects; another runner may take the next.
    yield* outbox.notifyAvailable;
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
    runDaemon: Effect.all(
      Array.from({ length: DAEMON_CONCURRENCY }, () =>
        Effect.forever(Effect.andThen(drain, outbox.awaitAvailable)),
      ),
      { concurrency: "unbounded", discard: true },
    ).pipe(Effect.andThen(Effect.never)),
  });
});

export const layer = Layer.effect(OrchestrationEffectWorkerV2, make);

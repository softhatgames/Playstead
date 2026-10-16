import { CommandId, type ThreadId } from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2ThreadProjection,
} from "@playstead/contracts/orchestrationV2";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as EffectOutbox from "./EffectOutbox.ts";
import * as EventSink from "./EventSink.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export class ProviderRuntimeRecoveryError extends Schema.TaggedError<ProviderRuntimeRecoveryError>()(
  "ProviderRuntimeRecoveryError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Provider runtime recovery failed during ${this.operation}.`;
  }
}

export type RecoveryTrigger = "startup" | "shutdown";

export interface ProviderRuntimeReconciliation {
  readonly cancelledRuns: number;
  readonly stoppedSessions: number;
  readonly cancelledEffects: number;
}

const isUnfinished = (status: string) =>
  status === "pending" || status === "running" || status === "waiting";

/**
 * The events that settle what a thread's projection says is still at work
 * when no provider can be (T3 Code's `reconcileProjection` in
 * `ProviderRuntimeRecoveryService.ts` at 2577baf, without queued runs,
 * runtime requests, subagents, background work or the restart
 * continuation, which Playstead does not have). An active run and
 * everything under it is cancelled, a streaming message stops streaming,
 * an active provider thread is idle and every provider session is stopped.
 * Each run's own event comes after everything under it.
 */
const reconcileEvents = (
  projection: OrchestrationV2ThreadProjection,
  now: string,
): ReadonlyArray<EventSink.NewDomainEvent> => {
  const threadId = projection.thread.id;
  const events: Array<EventSink.NewDomainEvent> = [];
  const runs = projection.runs.filter((run) => ACTIVE_RUN_STATUSES.has(run.status));
  for (const run of runs) {
    const base = { threadId, runId: run.id, occurredAt: now };
    const attempts = projection.attempts.filter((attempt) => attempt.runId === run.id);
    for (const attempt of attempts.filter((candidate) => isUnfinished(candidate.status))) {
      events.push({
        ...base,
        type: "run-attempt.updated",
        payload: { ...attempt, status: "cancelled", completedAt: now },
      });
    }
    for (const node of projection.nodes.filter(
      (candidate) => candidate.runId === run.id && isUnfinished(candidate.status),
    )) {
      events.push({
        ...base,
        type: "node.updated",
        payload: { ...node, status: "cancelled", completedAt: now },
      });
    }
    for (const turn of projection.providerTurns.filter(
      (candidate) =>
        attempts.some((attempt) => attempt.id === candidate.runAttemptId) &&
        isUnfinished(candidate.status),
    )) {
      events.push({
        ...base,
        type: "provider-turn.updated",
        payload: { ...turn, status: "cancelled", completedAt: now },
      });
    }
    for (const message of projection.messages.filter(
      (candidate) => candidate.runId === run.id && candidate.streaming,
    )) {
      events.push({
        ...base,
        type: "message.updated",
        payload: { ...message, streaming: false, updatedAt: now },
      });
    }
    for (const item of projection.turnItems.filter(
      (candidate) => candidate.runId === run.id && isUnfinished(candidate.status),
    )) {
      events.push({
        ...base,
        type: "turn-item.updated",
        payload: {
          ...item,
          ...(item.type === "assistant_message" ? { streaming: false } : {}),
          status: "cancelled",
          completedAt: now,
          updatedAt: now,
        },
      });
    }
  }
  for (const providerThread of projection.providerThreads.filter(
    (candidate) => candidate.status === "active",
  )) {
    events.push({
      threadId,
      occurredAt: now,
      type: "provider-thread.updated",
      payload: { ...providerThread, status: "idle", updatedAt: now },
    });
  }
  for (const session of projection.providerSessions.filter(
    (candidate) => candidate.status !== "stopped" && candidate.status !== "error",
  )) {
    events.push({
      threadId,
      occurredAt: now,
      type: "provider-session.updated",
      payload: { ...session, status: "stopped", updatedAt: now, lastError: null },
    });
  }
  for (const run of runs) {
    events.push({
      threadId,
      runId: run.id,
      occurredAt: now,
      type: "run.updated",
      payload: { ...run, status: "cancelled", completedAt: now },
    });
  }
  return events;
};

/**
 * Settles the work a server that has stopped left behind (T3 Code's
 * `apps/server/src/orchestration-v2/ProviderRuntimeRecoveryService.ts` at
 * 2577baf). Provider processes do not outlive the server, so on startup a
 * run still active in SQLite will never end by itself: `recover` cancels it,
 * with the turn's effects, before the server takes commands. The server
 * does the same as it shuts down. Each thread's settlement is one command,
 * so a client sees it as one change.
 */
export class ProviderRuntimeRecoveryService extends Context.Service<
  ProviderRuntimeRecoveryService,
  {
    readonly reconcile: (
      trigger: RecoveryTrigger,
    ) => Effect.Effect<ProviderRuntimeReconciliation, ProviderRuntimeRecoveryError>;
    readonly recover: Effect.Effect<ProviderRuntimeReconciliation, ProviderRuntimeRecoveryError>;
  }
>()("@playstead/server/orchestration-v2/ProviderRuntimeRecoveryService") {}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const outbox = yield* EffectOutbox.EffectOutboxV2;

  const reconcileThread = (threadId: ThreadId, trigger: RecoveryTrigger) =>
    Effect.gen(function* () {
      const projection = yield* projections.getThread(threadId);
      if (Option.isNone(projection)) return { cancelledRuns: 0, stoppedSessions: 0 };
      const now = yield* DateTime.now;
      const nowIso = DateTime.formatIso(now);
      const reason = `Cancelled because the server ${trigger === "startup" ? "restarted" : "shut down"} before the provider work completed.`;
      const events = reconcileEvents(projection.value, nowIso);
      if (events.length === 0) {
        yield* outbox.cancelUnsettled({ threadId, reason, now: nowIso });
      } else {
        yield* eventSink.commitCommand({
          commandId: CommandId.make(`command:runtime-reconcile:${trigger}:${threadId}:${nowIso}`),
          threadId,
          commandType: "provider-runtime.reconcile",
          acceptedAt: now,
          events,
          effects: [],
          cancelUnsettledEffects: { reason },
        });
      }
      return {
        cancelledRuns: events.filter((event) => event.type === "run.updated").length,
        stoppedSessions: events.filter((event) => event.type === "provider-session.updated").length,
      };
    });

  const reconcile = (trigger: RecoveryTrigger) =>
    Effect.gen(function* () {
      let cancelledRuns = 0;
      let stoppedSessions = 0;
      for (const threadId of yield* projections.listRecoveryThreadIds) {
        const settled = yield* reconcileThread(threadId, trigger);
        cancelledRuns += settled.cancelledRuns;
        stoppedSessions += settled.stoppedSessions;
      }
      const cancelledEffects = yield* outbox.reconcileAfterProcessLoss({
        reason: "Cancelled because the server that started it stopped.",
        now: DateTime.formatIso(yield* DateTime.now),
      });
      return { cancelledRuns, stoppedSessions, cancelledEffects };
    }).pipe(
      Effect.mapError(
        (cause) => new ProviderRuntimeRecoveryError({ operation: `reconcile-${trigger}`, cause }),
      ),
    );

  return ProviderRuntimeRecoveryService.of({ reconcile, recover: reconcile("startup") });
});

export const layer = Layer.effect(ProviderRuntimeRecoveryService, make);

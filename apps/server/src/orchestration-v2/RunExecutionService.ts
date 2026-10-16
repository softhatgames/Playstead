import { TurnItemId } from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2ExecutionNode,
  OrchestrationV2ProviderFailure,
  OrchestrationV2ProviderSession,
  OrchestrationV2ProviderThread,
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
  OrchestrationV2RunAttempt,
} from "@playstead/contracts/orchestrationV2";
import type {
  ProviderAdapterV2Event,
  ProviderAdapterV2SessionRuntime,
  ProviderAdapterV2TurnInput,
} from "@playstead/provider-core/server/ProviderAdapter";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as EventSink from "./EventSink.ts";

/** The run's records as the turn started them; the final events update these. */
export interface RootRunRecords {
  readonly run: OrchestrationV2Run;
  readonly attempt: OrchestrationV2RunAttempt;
  readonly rootNode: OrchestrationV2ExecutionNode;
  readonly providerSession: OrchestrationV2ProviderSession;
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly providerTurn: OrchestrationV2ProviderTurn;
}

type TerminalStatus = "completed" | "interrupted" | "cancelled" | "failed";

/**
 * A provider event as domain events for the run (T3 Code's
 * `ProviderEventIngestorV2.ingestNormalized` at 2577baf, trimmed). An
 * assistant item also updates the conversation message it carries.
 */
const ingestProviderEvent = (
  event: Exclude<ProviderAdapterV2Event, { readonly type: "turn.terminal" }>,
  records: RootRunRecords,
  now: string,
): ReadonlyArray<EventSink.NewDomainEvent> => {
  const base = { threadId: records.run.threadId, runId: records.run.id, occurredAt: now };
  switch (event.type) {
    case "node.updated":
      return [{ ...base, type: "node.updated", payload: event.node }];
    case "turn_item.updated": {
      const item = event.turnItem;
      const itemEvent: EventSink.NewDomainEvent = {
        ...base,
        type: "turn-item.updated",
        payload: item,
      };
      if (item.type !== "assistant_message") return [itemEvent];
      return [
        {
          ...base,
          type: "message.updated",
          payload: {
            id: item.messageId,
            threadId: item.threadId,
            runId: item.runId,
            nodeId: item.nodeId,
            role: "assistant",
            text: item.text,
            streaming: item.streaming,
            createdAt: item.startedAt ?? now,
            updatedAt: now,
          },
        },
        itemEvent,
      ];
    }
  }
};

/**
 * The events that end a run (T3 Code's `writeFinalRunEvents` in
 * `RunExecutionService.ts` at 2577baf). T3 Code writes a completed run as
 * `waiting` until its checkpoint is captured; Playstead takes no
 * checkpoints, so the run is written `completed` here directly. The run comes
 * last, so a client that sees it end sees everything under it ended too.
 */
const finalRunEvents = (
  records: RootRunRecords,
  status: TerminalStatus,
  failure: OrchestrationV2ProviderFailure | null,
  now: string,
): ReadonlyArray<EventSink.NewDomainEvent> => {
  const base = { threadId: records.run.threadId, runId: records.run.id, occurredAt: now };
  const failed: ReadonlyArray<EventSink.NewDomainEvent> =
    failure === null
      ? []
      : [
          {
            ...base,
            type: "turn-item.updated",
            payload: {
              id: TurnItemId.make(`item:${records.providerTurn.id}:error`),
              threadId: records.run.threadId,
              runId: records.run.id,
              nodeId: records.rootNode.id,
              providerThreadId: records.providerThread.id,
              providerTurnId: records.providerTurn.id,
              ordinal: 0,
              status: "failed",
              title: null,
              startedAt: now,
              completedAt: now,
              updatedAt: now,
              type: "error",
              failure,
            },
          },
        ];
  return [
    ...failed,
    {
      ...base,
      type: "provider-turn.updated",
      payload: { ...records.providerTurn, status, completedAt: now },
    },
    {
      ...base,
      type: "run-attempt.updated",
      payload: { ...records.attempt, status, completedAt: now },
    },
    { ...base, type: "node.updated", payload: { ...records.rootNode, status, completedAt: now } },
    {
      ...base,
      type: "provider-thread.updated",
      payload: { ...records.providerThread, status: "idle", updatedAt: now },
    },
    {
      ...base,
      type: "provider-session.updated",
      payload: { ...records.providerSession, status: "ready", updatedAt: now },
    },
    { ...base, type: "run.updated", payload: { ...records.run, status, completedAt: now } },
  ];
};

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/**
 * Runs a started turn to its end (T3 Code's `RunExecutionServiceV2.startRootRun`
 * at 2577baf). It subscribes to the session's events before sending the
 * message, then writes each of the turn's events through the event sink
 * until the turn's terminal event ends the run. A turn that fails to start,
 * or whose events stop first, ends the run as failed. The turn runs in the
 * background, so the effect that started it finishes at once.
 */
export class RunExecutionServiceV2 extends Context.Service<
  RunExecutionServiceV2,
  {
    readonly startRootRun: (input: {
      readonly session: ProviderAdapterV2SessionRuntime;
      readonly records: RootRunRecords;
      readonly turn: ProviderAdapterV2TurnInput;
    }) => Effect.Effect<void>;
  }
>()("@playstead/server/orchestration-v2/RunExecutionService/RunExecutionServiceV2") {}

export const failureFrom = (detail: string): OrchestrationV2ProviderFailure => ({
  class: "provider_error",
  message: detail.trim().length === 0 ? "The provider failed." : detail.slice(0, 4_096),
});

const make = Effect.gen(function* () {
  const eventSink = yield* EventSink.EventSinkV2;
  const serviceScope = yield* Effect.scope;

  const finalize = (
    records: RootRunRecords,
    status: TerminalStatus,
    failure: OrchestrationV2ProviderFailure | null,
  ) =>
    Effect.flatMap(nowIso, (now) => eventSink.write(finalRunEvents(records, status, failure, now)));

  const startRootRun = (input: {
    readonly session: ProviderAdapterV2SessionRuntime;
    readonly records: RootRunRecords;
    readonly turn: ProviderAdapterV2TurnInput;
  }) =>
    Effect.gen(function* () {
      const { records } = input;
      const subscribed = yield* Deferred.make<void>();
      const finished = yield* Ref.make(false);
      const providerTurnId = records.providerTurn.id;

      const consume = Effect.scoped(
        Effect.gen(function* () {
          const events = yield* input.session.subscribeEvents;
          yield* Deferred.succeed(subscribed, undefined);
          yield* events.pipe(
            Stream.takeUntil(
              (event) => event.type === "turn.terminal" && event.providerTurnId === providerTurnId,
            ),
            Stream.runForEach((event) =>
              Effect.gen(function* () {
                if (event.type === "turn.terminal") {
                  if (event.providerTurnId !== providerTurnId) return;
                  yield* Ref.set(finished, true);
                  yield* finalize(records, event.status, event.failure);
                  return;
                }
                yield* eventSink.write(ingestProviderEvent(event, records, yield* nowIso));
              }),
            ),
          );
          if (!(yield* Ref.get(finished))) {
            yield* Ref.set(finished, true);
            yield* finalize(
              records,
              "failed",
              failureFrom("The provider's session ended before the turn finished."),
            );
          }
        }),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Writing a provider turn's events failed.").pipe(
            Effect.annotateLogs({ runId: records.run.id, cause: String(cause) }),
          ),
        ),
      );

      yield* Effect.forkIn(consume, serviceScope);
      yield* Deferred.await(subscribed);
      yield* input.session.startTurn(input.turn).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("The provider turn failed to start.").pipe(
              Effect.annotateLogs({ runId: records.run.id, error: error.message }),
            );
            if (yield* Ref.getAndSet(finished, true)) return;
            yield* finalize(records, "failed", failureFrom(error.message)).pipe(Effect.ignore);
          }),
        ),
      );
    });

  return RunExecutionServiceV2.of({ startRootRun });
});

export const layer = Layer.effect(RunExecutionServiceV2, make);

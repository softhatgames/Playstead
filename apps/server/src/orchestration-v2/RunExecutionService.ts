import {
  type ProviderSessionId,
  type ProviderTurnId,
  type RunId,
  type RuntimeRequestId,
  type ThreadId,
  TurnItemId,
} from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2ProviderFailure,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2Run,
  type OrchestrationV2RunAttempt,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  type ProviderApprovalDecision,
  type ProviderUserInputAnswers,
} from "@playstead/contracts/orchestrationV2";
import type {
  ProviderAdapterV2Error,
  ProviderAdapterV2Event,
  ProviderAdapterV2SessionRuntime,
  ProviderAdapterV2TurnInput,
} from "@playstead/provider-core/server/ProviderAdapter";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { EventSinkWriteError } from "./EventSink.ts";
import * as EventSink from "./EventSink.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { interruptRequestItemId, interruptResultItem } from "./ThreadCommands.ts";

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
    case "turn_item.updated":
      return itemEvents(event.turnItem, base, now);
    case "runtime_request.updated":
      return [{ ...base, type: "runtime-request.updated", payload: event.runtimeRequest }];
    case "plan.updated":
      return [{ ...base, type: "plan.updated", payload: event.plan }];
  }
};

const itemEvents = (
  item: OrchestrationV2TurnItem,
  base: { readonly threadId: ThreadId; readonly runId: RunId; readonly occurredAt: string },
  now: string,
): ReadonlyArray<EventSink.NewDomainEvent> => {
  const itemEvent: EventSink.NewDomainEvent = { ...base, type: "turn-item.updated", payload: item };
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
};

const UNFINISHED_ITEM_STATUSES: ReadonlySet<OrchestrationV2TurnItem["status"]> = new Set([
  "pending",
  "running",
  "waiting",
]);

/** The item that shows a runtime request: its approval or its questions. */
const isRequestItem = (
  item: OrchestrationV2TurnItem,
): item is Extract<OrchestrationV2TurnItem, { type: "approval_request" | "user_input_request" }> =>
  item.type === "approval_request" || item.type === "user_input_request";

/**
 * The approvals and questions a turn leaves unanswered when it ends,
 * however it ends: each pending runtime request is cancelled, with its node
 * and item, so the pending approval and user-input panels clear (T3 Code's
 * `dismissNativeUserInputs` in `ProviderEventIngestor.ts` at 2577baf, which
 * does it for questions only).
 */
const unansweredRequestSettlement = (
  projection: OrchestrationV2ThreadProjection,
  run: OrchestrationV2Run,
  providerTurnId: ProviderTurnId | null,
  now: string,
): ReadonlyArray<EventSink.NewDomainEvent> => {
  const base = { threadId: run.threadId, runId: run.id, occurredAt: now };
  return projection.runtimeRequests.flatMap((request) => {
    if (request.status !== "pending" || request.providerTurnId !== providerTurnId) return [];
    const node = projection.nodes.find((candidate) => candidate.id === request.nodeId);
    const items = projection.turnItems.filter(
      (item) => isRequestItem(item) && item.requestId === request.id,
    );
    return [
      {
        ...base,
        type: "runtime-request.updated",
        payload: { ...request, status: "cancelled", resolvedAt: now },
      } as const,
      ...(node === undefined
        ? []
        : [
            {
              ...base,
              type: "node.updated",
              payload: { ...node, status: "cancelled", completedAt: now },
            } as const,
          ]),
      ...items.map(
        (item) =>
          ({
            ...base,
            type: "turn-item.updated",
            payload: { ...item, status: "cancelled", completedAt: now, updatedAt: now },
          }) as const,
      ),
    ];
  });
};

/**
 * What an interrupted run leaves settled, read from its projection: an
 * approval or a question it waits on is cancelled, every other item still open ends
 * interrupted, a streaming reply stops, and an interrupt the person asked
 * for gets its result item (T3 Code writes it when the turn's terminal
 * pairs a `run_interrupt_request`, in `RunExecutionService.ts`
 * `makeInterruptResultTurnItem`).
 */
const interruptedRunSettlement = (
  projection: OrchestrationV2ThreadProjection,
  run: OrchestrationV2Run,
  providerTurnId: ProviderTurnId | null,
  now: string,
): ReadonlyArray<EventSink.NewDomainEvent> => {
  const base = { threadId: run.threadId, runId: run.id, occurredAt: now };
  const requests = unansweredRequestSettlement(projection, run, providerTurnId, now);
  const open = projection.turnItems.flatMap((item) => {
    if (item.runId !== run.id || !UNFINISHED_ITEM_STATUSES.has(item.status)) return [];
    if (isRequestItem(item)) return [];
    const ended = { ...item, status: "interrupted" as const, completedAt: now, updatedAt: now };
    return itemEvents(
      ended.type === "assistant_message" || ended.type === "proposed_plan"
        ? { ...ended, streaming: false }
        : ended,
      base,
      now,
    );
  });
  const requested = projection.turnItems.some((item) => item.id === interruptRequestItemId(run.id));
  const result: ReadonlyArray<EventSink.NewDomainEvent> = requested
    ? [
        {
          ...base,
          type: "turn-item.updated",
          payload: interruptResultItem({
            run,
            providerTurnId,
            message: "Run interrupted by the person",
            now,
          }),
        },
      ]
    : [];
  return [...requests, ...open, ...result];
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

/**
 * An interrupted run that no live turn can end, such as one whose session
 * is gone, ended from what its projection holds (T3 Code's
 * `settleInterruptedRun`).
 */
const interruptedFromProjection = (
  projection: OrchestrationV2ThreadProjection,
  run: OrchestrationV2Run,
  providerTurnId: ProviderTurnId,
  now: string,
): ReadonlyArray<EventSink.NewDomainEvent> => {
  const base = { threadId: run.threadId, runId: run.id, occurredAt: now };
  const status = "interrupted" as const;
  const providerTurn = projection.providerTurns.find((turn) => turn.id === providerTurnId);
  const attempt = projection.attempts.find((candidate) => candidate.id === run.activeAttemptId);
  const rootNode = projection.nodes.find((node) => node.id === run.rootNodeId);
  const providerThread = projection.providerThreads.find(
    (candidate) => candidate.id === run.providerThreadId,
  );
  return [
    ...interruptedRunSettlement(projection, run, providerTurnId, now),
    ...(providerTurn === undefined
      ? []
      : [
          {
            ...base,
            type: "provider-turn.updated",
            payload: { ...providerTurn, status, completedAt: now },
          } as const,
        ]),
    ...(attempt === undefined
      ? []
      : [
          {
            ...base,
            type: "run-attempt.updated",
            payload: { ...attempt, status, completedAt: now },
          } as const,
        ]),
    ...(rootNode === undefined
      ? []
      : [
          {
            ...base,
            type: "node.updated",
            payload: { ...rootNode, status, completedAt: now },
          } as const,
        ]),
    ...(providerThread === undefined
      ? []
      : [
          {
            ...base,
            type: "provider-thread.updated",
            payload: { ...providerThread, status: "idle", updatedAt: now },
          } as const,
        ]),
    { ...base, type: "run.updated", payload: { ...run, status, completedAt: now } },
  ];
};

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/** A run whose turn this service is running, until the turn ends. */
interface LiveRun {
  readonly session: ProviderAdapterV2SessionRuntime;
  readonly records: RootRunRecords;
  /** Ends the run once, whoever gets there first. */
  readonly finish: (
    status: TerminalStatus,
    failure: OrchestrationV2ProviderFailure | null,
  ) => Effect.Effect<void, EventSinkWriteError | ProjectionStore.ProjectionStoreV2Error>;
}

/**
 * Runs a started turn to its end (T3 Code's `RunExecutionServiceV2.startRootRun`
 * at 2577baf). It subscribes to the session's events before sending the
 * message, then writes each of the turn's events through the event sink
 * until the turn's terminal event ends the run. A turn that fails to start,
 * or whose events stop first, ends the run as failed. The turn runs in the
 * background, so the effect that started it finishes at once, and an
 * interrupt never waits behind it.
 *
 * Every write is guarded on the run still being active (T3 Code's
 * `writeIfRunCurrent`), so nothing a provider sends late reopens a run that
 * has ended.
 */
export class RunExecutionServiceV2 extends Context.Service<
  RunExecutionServiceV2,
  {
    readonly startRootRun: (input: {
      readonly session: ProviderAdapterV2SessionRuntime;
      readonly records: RootRunRecords;
      readonly turn: ProviderAdapterV2TurnInput;
    }) => Effect.Effect<void>;
    /**
     * The effect worker's `provider-turn.interrupt` (T3 Code's
     * `ProviderTurnControlServiceV2.interrupt`): asks the run's session to
     * stop its turn, and returns. The run ends with the turn's terminal
     * event; a run no live turn can end is ended interrupted here.
     */
    readonly interruptRun: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
      readonly providerTurnId: ProviderTurnId;
    }) => Effect.Effect<void, EventSinkWriteError | ProjectionStore.ProjectionStoreV2Error>;
    /**
     * The effect worker's `runtime-request.respond` (T3 Code's
     * `RuntimeRequestServiceV2.respond`): gives the run's live session the
     * person's decision or answers. Fails when the session that asked is gone.
     */
    readonly respondToRuntimeRequest: (input: {
      readonly runId: RunId;
      readonly providerSessionId: ProviderSessionId;
      readonly requestId: RuntimeRequestId;
      readonly decision?: ProviderApprovalDecision;
      readonly answers?: ProviderUserInputAnswers;
    }) => Effect.Effect<void, ProviderAdapterV2Error | RuntimeRequestResponseError>;
  }
>()("@playstead/server/orchestration-v2/RunExecutionService/RunExecutionServiceV2") {}

/** The answers have nowhere to go: the session that asked is gone (T3 Code's `RuntimeRequestResponseExecutionError`). */
export class RuntimeRequestResponseError extends Schema.TaggedError<RuntimeRequestResponseError>()(
  "RuntimeRequestResponseError",
  { requestId: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export const failureFrom = (detail: string): OrchestrationV2ProviderFailure => ({
  class: "provider_error",
  message: detail.trim().length === 0 ? "The provider failed." : detail.slice(0, 4_096),
});

const make = Effect.gen(function* () {
  const eventSink = yield* EventSink.EventSinkV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const serviceScope = yield* Effect.scope;
  const live = new Map<RunId, LiveRun>();

  const whileActive = (runId: RunId, events: ReadonlyArray<EventSink.NewDomainEvent>) =>
    eventSink.writeIfRunStatus({ runId, statuses: ACTIVE_RUN_STATUSES }, events);

  const finalize = (
    records: RootRunRecords,
    status: TerminalStatus,
    failure: OrchestrationV2ProviderFailure | null,
  ) =>
    Effect.gen(function* () {
      const now = yield* nowIso;
      const settlement = Option.match(yield* projections.getThread(records.run.threadId), {
        onNone: () => [],
        onSome: (projection) =>
          status === "interrupted"
            ? interruptedRunSettlement(projection, records.run, records.providerTurn.id, now)
            : unansweredRequestSettlement(projection, records.run, records.providerTurn.id, now),
      });
      yield* whileActive(records.run.id, [
        ...settlement,
        ...finalRunEvents(records, status, failure, now),
      ]);
    });

  const startRootRun = (input: {
    readonly session: ProviderAdapterV2SessionRuntime;
    readonly records: RootRunRecords;
    readonly turn: ProviderAdapterV2TurnInput;
  }) =>
    Effect.gen(function* () {
      const { records } = input;
      const runId = records.run.id;
      const subscribed = yield* Deferred.make<void>();
      const finished = yield* Ref.make(false);
      const done = yield* Deferred.make<void>();
      const providerTurnId = records.providerTurn.id;

      const finish: LiveRun["finish"] = (status, failure) =>
        Effect.gen(function* () {
          if (yield* Ref.getAndSet(finished, true)) return;
          live.delete(runId);
          yield* finalize(records, status, failure).pipe(
            Effect.ensuring(Deferred.succeed(done, undefined)),
          );
        });
      live.set(runId, { session: input.session, records, finish });

      const consume = Effect.scoped(
        Effect.gen(function* () {
          const events = yield* input.session.subscribeEvents;
          yield* Deferred.succeed(subscribed, undefined);
          // The message goes out once the events are listened to; a turn
          // that never starts must not hold up its interrupt.
          yield* input.session.startTurn(input.turn).pipe(
            Effect.catch((error) =>
              Effect.andThen(
                Effect.logWarning("The provider turn failed to start.").pipe(
                  Effect.annotateLogs({ runId, error: error.message }),
                ),
                finish("failed", failureFrom(error.message)),
              ),
            ),
            Effect.forkScoped,
          );
          // Until the turn's terminal, or until the run ended another way.
          yield* Effect.raceFirst(
            events.pipe(
              Stream.takeUntil(
                (event) =>
                  event.type === "turn.terminal" && event.providerTurnId === providerTurnId,
              ),
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  if (event.type === "turn.terminal") {
                    if (event.providerTurnId !== providerTurnId) return;
                    yield* finish(event.status, event.failure);
                    return;
                  }
                  yield* whileActive(runId, ingestProviderEvent(event, records, yield* nowIso));
                }),
              ),
            ),
            Deferred.await(done),
          );
          yield* finish(
            "failed",
            failureFrom("The provider's session ended before the turn finished."),
          );
        }),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Writing a provider turn's events failed.").pipe(
            Effect.annotateLogs({ runId, cause: String(cause) }),
          ),
        ),
        Effect.ensuring(Effect.sync(() => live.delete(runId))),
      );

      yield* Effect.forkIn(consume, serviceScope);
      yield* Deferred.await(subscribed);
    });

  const interruptRun = (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
    readonly providerTurnId: ProviderTurnId;
  }) =>
    Effect.gen(function* () {
      const running = live.get(input.runId);
      if (running === undefined) {
        // No live turn will end this run: its session is gone. End it here.
        const projection = yield* projections.getThread(input.threadId);
        if (Option.isNone(projection)) return;
        const run = projection.value.runs.find((candidate) => candidate.id === input.runId);
        if (run === undefined || !ACTIVE_RUN_STATUSES.has(run.status)) return;
        yield* whileActive(
          run.id,
          interruptedFromProjection(projection.value, run, input.providerTurnId, yield* nowIso),
        );
        return;
      }
      // The adapter waits for its provider and ends the turn itself if the
      // provider never does; this effect does not wait for either.
      yield* running.session
        .interruptTurn({
          providerThread: running.records.providerThread,
          providerTurnId: input.providerTurnId,
        })
        .pipe(
          Effect.catch((error) =>
            Effect.andThen(
              Effect.logWarning("The provider could not be asked to stop its turn.").pipe(
                Effect.annotateLogs({ runId: input.runId, error: error.message }),
              ),
              running.finish("interrupted", null),
            ),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("Interrupting a provider turn failed.").pipe(
              Effect.annotateLogs({ runId: input.runId, cause: String(cause) }),
            ),
          ),
          Effect.forkIn(serviceScope),
        );
    });

  const respondToRuntimeRequest = (input: {
    readonly runId: RunId;
    readonly providerSessionId: ProviderSessionId;
    readonly requestId: RuntimeRequestId;
    readonly decision?: ProviderApprovalDecision;
    readonly answers?: ProviderUserInputAnswers;
  }) =>
    Effect.suspend(
      (): Effect.Effect<void, ProviderAdapterV2Error | RuntimeRequestResponseError> => {
        const running = live.get(input.runId);
        if (
          running === undefined ||
          running.session.providerSession.id !== input.providerSessionId
        ) {
          return Effect.fail(
            new RuntimeRequestResponseError({
              requestId: input.requestId,
              detail: `Provider session ${input.providerSessionId} is not active for runtime request ${input.requestId}.`,
            }),
          );
        }
        return running.session.respondToRuntimeRequest({
          requestId: input.requestId,
          ...(input.decision === undefined ? {} : { decision: input.decision }),
          ...(input.answers === undefined ? {} : { answers: input.answers }),
        });
      },
    );

  return RunExecutionServiceV2.of({ startRootRun, interruptRun, respondToRuntimeRequest });
});

export const layer = Layer.effect(RunExecutionServiceV2, make);

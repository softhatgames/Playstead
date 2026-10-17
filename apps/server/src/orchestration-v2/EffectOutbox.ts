import {
  CommandId,
  MessageId,
  ProviderSessionId,
  ProviderTurnId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@playstead/contracts/baseSchemas";
import { ProviderUserInputAnswers } from "@playstead/contracts/orchestrationV2";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The work a command leaves for the effect worker (T3 Code's
 * `OrchestrationEffectRequestV2` at 2577baf): starting a run's provider
 * turn, interrupting it, giving the provider the person's answers to its
 * question, stopping a thread's provider session, and generating the
 * thread's title from its first message or, for a regenerate, its
 * conversation. There is no checkpoint or cleanup.
 */
const OrchestrationEffectRequestV2 = Schema.Union([
  Schema.Struct({ type: Schema.Literal("provider-turn.start"), runId: RunId }),
  Schema.Struct({
    type: Schema.Literal("provider-turn.interrupt"),
    runId: RunId,
    providerTurnId: ProviderTurnId,
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-request.respond"),
    runId: RunId,
    providerSessionId: ProviderSessionId,
    requestId: RuntimeRequestId,
    answers: ProviderUserInputAnswers,
  }),
  Schema.Struct({
    type: Schema.Literal("provider-session.detach"),
    providerSessionId: ProviderSessionId,
    detail: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("thread-title.generate"),
    kind: Schema.Union([
      Schema.Struct({ type: Schema.Literal("initial"), messageId: MessageId }),
      Schema.Struct({ type: Schema.Literal("regenerate") }),
    ]),
  }),
]);
export type OrchestrationEffectRequestV2 = typeof OrchestrationEffectRequestV2.Type;

/**
 * Effects that can safely run again after the process that ran them is gone
 * (T3 Code's `REPLAY_SAFE_EFFECT_TYPES_AFTER_PROCESS_LOSS`): stopping a
 * provider session that no longer exists does nothing, and a title is only
 * applied while its request is still the thread's. Recovery leaves them to
 * run, and puts one a stopped server was running back in the queue.
 */
const REPLAY_SAFE_EFFECT_TYPES_AFTER_PROCESS_LOSS = [
  "provider-session.detach",
  "thread-title.generate",
] as const satisfies ReadonlyArray<OrchestrationEffectRequestV2["type"]>;

/**
 * Effects whose work dies with the process that ran them (T3 Code's
 * `PROCESS_BOUND_EFFECT_TYPES`): a provider turn started by a server that
 * has gone cannot be picked up again, so recovery cancels them. Every
 * effect type is one list or the other.
 */
const PROCESS_BOUND_EFFECT_TYPES = [
  "provider-turn.start",
  "provider-turn.interrupt",
  "runtime-request.respond",
] as const satisfies ReadonlyArray<OrchestrationEffectRequestV2["type"]>;

// Every effect type is classified: adding one without choosing fails to compile.
type UnclassifiedEffectType = Exclude<
  OrchestrationEffectRequestV2["type"],
  | (typeof REPLAY_SAFE_EFFECT_TYPES_AFTER_PROCESS_LOSS)[number]
  | (typeof PROCESS_BOUND_EFFECT_TYPES)[number]
>;
const everyEffectTypeClassified: [UnclassifiedEffectType] extends [never] ? true : never = true;
void everyEffectTypeClassified;

/** Which of a thread's effects a command cancels (T3 Code's `cancelUnsettledEffects`). */
export interface CancelUnsettledEffects {
  readonly reason: string;
  /** By default every process-bound type. */
  readonly effectTypes?: ReadonlyArray<OrchestrationEffectRequestV2["type"]>;
}

export interface PendingEffect {
  readonly id: string;
  readonly request: OrchestrationEffectRequestV2;
}

export interface ClaimedEffect extends PendingEffect {
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly attemptCount: number;
}

export class EffectOutboxError extends Schema.TaggedError<EffectOutboxError>()(
  "EffectOutboxError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Effect outbox operation '${this.operation}' failed.`;
  }
}

/**
 * The effect outbox, `orchestration_v2_effect_outbox` (T3 Code's
 * `apps/server/src/orchestration-v2/EffectOutbox.ts` at 2577baf). Effects are
 * enqueued in the transaction that commits their command and claimed in
 * order, at most one running per thread in each of two lanes: titles in
 * their own, so a title is generated while the thread's turn goes on, and
 * everything else in the other. A failed effect is final: nothing
 * retries it, since starting a turn twice would send the message twice.
 * A cancelled effect that is running is told through `awaitCancellation`,
 * so the worker stops it (T3 Code's `signalCancellations`).
 */
export class EffectOutboxV2 extends Context.Service<
  EffectOutboxV2,
  {
    /** Call inside the commit transaction; call `notifyAvailable` after it commits. */
    readonly enqueue: (input: {
      readonly commandId: CommandId;
      readonly threadId: ThreadId;
      readonly effects: ReadonlyArray<PendingEffect>;
      readonly now: string;
    }) => Effect.Effect<void, EffectOutboxError>;
    /** The oldest pending effect of a thread with nothing running, now running. */
    readonly claimNext: (
      now: string,
    ) => Effect.Effect<Option.Option<ClaimedEffect>, EffectOutboxError>;
    readonly succeed: (effectId: string, now: string) => Effect.Effect<void, EffectOutboxError>;
    readonly fail: (
      effectId: string,
      error: string,
      now: string,
    ) => Effect.Effect<void, EffectOutboxError>;
    /**
     * Cancels a thread's process-bound effects (or only those of
     * `effectTypes`) that are pending or running, and returns their ids.
     * Call inside the transaction that settles the thread's work, then
     * `signalCancellations` once it has committed.
     */
    readonly cancelUnsettled: (input: {
      readonly threadId: ThreadId;
      readonly reason: string;
      readonly now: string;
      readonly effectTypes?: ReadonlyArray<OrchestrationEffectRequestV2["type"]>;
    }) => Effect.Effect<ReadonlyArray<string>, EffectOutboxError>;
    /** Tells the worker running any of these effects that they were cancelled. */
    readonly signalCancellations: (effectIds: ReadonlyArray<string>) => Effect.Effect<void>;
    /**
     * Resolves when the effect is cancelled, while the worker runs it; the
     * scope's end stops listening.
     */
    readonly awaitCancellation: (effectId: string) => Effect.Effect<void, never, Scope.Scope>;
    /**
     * Settles the effects still marked running, which only a process that
     * has gone could have claimed (T3 Code's `reconcileAfterProcessLoss`):
     * process-bound ones are cancelled, replay-safe ones go back in the queue.
     */
    readonly reconcileAfterProcessLoss: (input: {
      readonly reason: string;
      readonly now: string;
    }) => Effect.Effect<
      { readonly cancelled: number; readonly requeued: number },
      EffectOutboxError
    >;
    readonly notifyAvailable: Effect.Effect<void>;
    /** Waits until something was enqueued since the last wait. */
    readonly awaitAvailable: Effect.Effect<void>;
  }
>()("@playstead/server/orchestration-v2/EffectOutbox/EffectOutboxV2") {}

const decodeRequest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationEffectRequestV2),
);
const encodeRequest = Schema.encodeEffect(Schema.fromJsonString(OrchestrationEffectRequestV2));
const decodeIds = Schema.decodeUnknownEffect(
  Schema.Struct({ commandId: CommandId, threadId: ThreadId }),
);

interface ClaimedRow {
  readonly effectId: string;
  readonly commandId: string;
  readonly threadId: string;
  readonly requestJson: string;
  readonly attemptCount: number;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const available = yield* Queue.sliding<void>(1);
  const failWith = (operation: string) => (cause: unknown) =>
    new EffectOutboxError({ operation, cause });

  const enqueue = (input: {
    readonly commandId: CommandId;
    readonly threadId: ThreadId;
    readonly effects: ReadonlyArray<PendingEffect>;
    readonly now: string;
  }) =>
    Effect.forEach(
      input.effects,
      (effect) =>
        Effect.flatMap(
          encodeRequest(effect.request),
          (requestJson) => sql`
            INSERT INTO orchestration_v2_effect_outbox (
              effect_id, command_id, thread_id, effect_type, request_json,
              status, attempt_count, last_error, created_at, updated_at
            )
            VALUES (
              ${effect.id}, ${input.commandId}, ${input.threadId}, ${effect.request.type},
              ${requestJson}, 'pending', 0, NULL, ${input.now}, ${input.now}
            )
          `,
        ),
      { discard: true },
    ).pipe(Effect.mapError(failWith("enqueue")));

  // One statement, so a claim is atomic: the oldest pending row whose thread
  // has nothing running and no older pending row in the same lane.
  const claimNext = (now: string) =>
    sql<ClaimedRow>`
      UPDATE orchestration_v2_effect_outbox
      SET status = 'running', attempt_count = attempt_count + 1, updated_at = ${now}
      WHERE effect_id = (
        SELECT candidate.effect_id
        FROM orchestration_v2_effect_outbox AS candidate
        WHERE candidate.status = 'pending'
          AND NOT EXISTS (
            SELECT 1 FROM orchestration_v2_effect_outbox AS other
            WHERE other.thread_id = candidate.thread_id
              AND (
                other.status = 'running'
                OR (other.status = 'pending' AND other.rowid < candidate.rowid)
              )
              AND (
                (
                  candidate.effect_type = 'thread-title.generate'
                  AND other.effect_type = 'thread-title.generate'
                )
                OR (
                  candidate.effect_type != 'thread-title.generate'
                  AND other.effect_type != 'thread-title.generate'
                )
              )
          )
        ORDER BY candidate.rowid ASC
        LIMIT 1
      )
      RETURNING
        effect_id AS "effectId",
        command_id AS "commandId",
        thread_id AS "threadId",
        request_json AS "requestJson",
        attempt_count AS "attemptCount"
    `.pipe(
      Effect.flatMap((rows) => {
        const row = rows[0];
        if (row === undefined) return Effect.succeedNone;
        return Effect.all({
          request: decodeRequest(row.requestJson),
          ids: decodeIds({ commandId: row.commandId, threadId: row.threadId }),
        }).pipe(
          Effect.map(({ request, ids }) =>
            Option.some<ClaimedEffect>({
              id: row.effectId,
              ...ids,
              request,
              attemptCount: row.attemptCount,
            }),
          ),
        );
      }),
      Effect.mapError(failWith("claimNext")),
    );

  const settle = (
    status: "succeeded" | "failed",
    effectId: string,
    error: string | null,
    now: string,
  ) =>
    // A cancelled effect stays cancelled, whatever its work reports after.
    sql`
      UPDATE orchestration_v2_effect_outbox
      SET status = ${status}, last_error = ${error}, updated_at = ${now}
      WHERE effect_id = ${effectId} AND status = 'running'
    `.pipe(Effect.asVoid, Effect.mapError(failWith(status === "succeeded" ? "succeed" : "fail")));

  const cancelUnsettled = (input: {
    readonly threadId: ThreadId;
    readonly reason: string;
    readonly now: string;
    readonly effectTypes?: ReadonlyArray<OrchestrationEffectRequestV2["type"]>;
  }) =>
    sql<{ readonly effectId: string }>`
      UPDATE orchestration_v2_effect_outbox
      SET status = 'cancelled', last_error = ${input.reason}, updated_at = ${input.now}
      WHERE thread_id = ${input.threadId}
        AND status IN ('pending', 'running')
        AND ${sql.in("effect_type", input.effectTypes ?? PROCESS_BOUND_EFFECT_TYPES)}
      RETURNING effect_id AS "effectId"
    `.pipe(
      Effect.map((rows) => rows.map((row) => row.effectId)),
      Effect.mapError(failWith("cancelUnsettled")),
    );

  // The effects the worker is running, each with the signal that cancels it.
  const running = new Map<string, Deferred.Deferred<void>>();
  const awaitCancellation = (effectId: string) =>
    Effect.acquireRelease(
      Effect.tap(Deferred.make<void>(), (signal) =>
        Effect.sync(() => running.set(effectId, signal)),
      ),
      () => Effect.sync(() => running.delete(effectId)),
    ).pipe(Effect.flatMap(Deferred.await));
  const signalCancellations = (effectIds: ReadonlyArray<string>) =>
    Effect.forEach(
      effectIds,
      (effectId) => {
        const signal = running.get(effectId);
        return signal === undefined ? Effect.void : Deferred.succeed(signal, undefined);
      },
      { discard: true },
    );

  const reconcileAfterProcessLoss = (input: { readonly reason: string; readonly now: string }) =>
    Effect.gen(function* () {
      const cancelled = yield* sql<{ readonly effectId: string }>`
        UPDATE orchestration_v2_effect_outbox
        SET status = 'cancelled', last_error = ${input.reason}, updated_at = ${input.now}
        WHERE status = 'running'
          AND ${sql.in("effect_type", PROCESS_BOUND_EFFECT_TYPES)}
        RETURNING effect_id AS "effectId"
      `;
      const requeued = yield* sql<{ readonly effectId: string }>`
        UPDATE orchestration_v2_effect_outbox
        SET status = 'pending', last_error = 'Requeued after the previous server process ended.',
          updated_at = ${input.now}
        WHERE status = 'running'
          AND ${sql.in("effect_type", REPLAY_SAFE_EFFECT_TYPES_AFTER_PROCESS_LOSS)}
        RETURNING effect_id AS "effectId"
      `;
      if (requeued.length > 0) yield* Queue.offer(available, undefined);
      return { cancelled: cancelled.length, requeued: requeued.length };
    }).pipe(Effect.mapError(failWith("reconcileAfterProcessLoss")));

  return EffectOutboxV2.of({
    enqueue,
    claimNext,
    cancelUnsettled,
    signalCancellations,
    awaitCancellation,
    reconcileAfterProcessLoss,
    succeed: (effectId, now) => settle("succeeded", effectId, null, now),
    fail: (effectId, error, now) => settle("failed", effectId, error, now),
    notifyAvailable: Queue.offer(available, undefined).pipe(Effect.asVoid),
    awaitAvailable: Queue.take(available),
  });
});

export const layer = Layer.effect(EffectOutboxV2, make);

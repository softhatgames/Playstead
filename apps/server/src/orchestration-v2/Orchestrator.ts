import {
  CommandId,
  NodeId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  type ThreadId,
  TurnItemId,
} from "@playstead/contracts/baseSchemas";
import {
  OrchestrationDispatchCommandError,
  type OrchestrationV2Command,
  type OrchestrationV2DispatchCommandResult,
  type OrchestrationV2ThreadProjection,
} from "@playstead/contracts/orchestrationV2";
import * as KeyedLock from "@playstead/shared/keyedLock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EventSink from "./EventSink.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as EventStore from "./EventStore.ts";
import {
  decideNextQueuedRun,
  decideThreadCommand,
  type ThreadCommandIds,
} from "./ThreadCommands.ts";

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
]);

/** Reading or writing failed; the command may not have been decided. */
export class OrchestratorDispatchError extends Schema.TaggedError<OrchestratorDispatchError>()(
  "OrchestratorDispatchError",
  { commandId: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Command ${this.commandId} could not be dispatched.`;
  }
}

/**
 * The orchestrator (T3 Code's `OrchestratorV2`,
 * `apps/server/src/orchestration-v2/Orchestrator.ts` at 2577baf, trimmed to
 * dispatch and the thread projection). Under the thread's lock it checks
 * the command's receipt, reads the state, decides with
 * `decideThreadCommand`, and commits the decision, or the rejection, through
 * the event sink. A command id sent again gets its first outcome back
 * without running anything twice.
 *
 * It also runs the queue, as T3 Code's orchestrator does: whenever a run
 * ends (except as recovery settles it) and after `queue.resume`, it starts
 * the thread's next queued run, under the thread's lock, unless the queue
 * is held or another run is active.
 */
export class OrchestratorV2 extends Context.Service<
  OrchestratorV2,
  {
    readonly dispatch: (
      command: OrchestrationV2Command,
    ) => Effect.Effect<
      OrchestrationV2DispatchCommandResult,
      OrchestrationDispatchCommandError | OrchestratorDispatchError
    >;
    readonly getThreadProjection: (
      threadId: ThreadId,
    ) => Effect.Effect<
      Option.Option<OrchestrationV2ThreadProjection>,
      ProjectionStore.ProjectionStoreV2Error
    >;
  }
>()("@playstead/server/orchestration-v2/Orchestrator/OrchestratorV2") {}

const make = Effect.gen(function* () {
  const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const adapters = yield* ProviderAdapterRegistry.ProviderAdapterRegistryV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const eventStore = yield* EventStore.EventStoreV2;
  const crypto = yield* Crypto.Crypto;
  const threadLocks = yield* KeyedLock.make<ThreadId>();

  const uuid = crypto.randomUUIDv4();
  const allocateIds = Effect.gen(function* () {
    return {
      runId: RunId.make(`run:${yield* uuid}`),
      attemptId: RunAttemptId.make(`run-attempt:${yield* uuid}`),
      rootNodeId: NodeId.make(`node:${yield* uuid}`),
      providerThreadId: ProviderThreadId.make(`provider-thread:${yield* uuid}`),
      userItemId: TurnItemId.make(`item:${yield* uuid}`),
      effectId: `effect:${yield* uuid}`,
    } satisfies ThreadCommandIds;
  });

  const toOutcome = (
    command: OrchestrationV2Command,
    receipt: CommandReceiptStore.CommandReceiptV2,
  ): Effect.Effect<OrchestrationV2DispatchCommandResult, OrchestrationDispatchCommandError> => {
    if (receipt.threadId !== command.threadId || receipt.commandType !== command.type) {
      return Effect.fail(
        new OrchestrationDispatchCommandError({
          commandId: command.commandId,
          message: `Command ${command.commandId} was already used by ${receipt.commandType} for ${receipt.threadId}.`,
        }),
      );
    }
    return receipt.status === "accepted"
      ? Effect.succeed({ sequence: receipt.resultSequence })
      : Effect.fail(
          new OrchestrationDispatchCommandError({
            commandId: command.commandId,
            message: receipt.error ?? "The command was rejected.",
          }),
        );
  };

  const decideAndCommit = (command: OrchestrationV2Command) =>
    Effect.gen(function* () {
      const previous = yield* receipts.getByCommandId(command.commandId);
      if (Option.isSome(previous)) return previous.value;

      const projection = Option.getOrUndefined(yield* projections.getThread(command.threadId));
      const state =
        command.type === "thread.create"
          ? {
              projection,
              projectExists: Option.isSome(yield* projects.get(command.projectId)),
              instanceHasAdapter: Option.isSome(
                yield* adapters.get(command.modelSelection.instanceId),
              ),
              supportsQueuedMessages: false,
            }
          : {
              projection,
              projectExists: true,
              instanceHasAdapter: true,
              supportsQueuedMessages:
                projection === undefined
                  ? false
                  : Option.match(yield* adapters.get(projection.thread.providerInstanceId), {
                      onNone: () => false,
                      onSome: (adapter) => adapter.capabilities.turns.supportsQueuedMessages,
                    }),
              // A plan implemented in a new thread is the original thread's.
              sourcePlanThread:
                command.type !== "message.dispatch" || command.sourcePlanRef === undefined
                  ? undefined
                  : command.sourcePlanRef.threadId === command.threadId
                    ? projection
                    : Option.getOrUndefined(
                        yield* projections.getThread(command.sourcePlanRef.threadId),
                      ),
            };
      const now = yield* DateTime.now;
      const decided = decideThreadCommand({
        command,
        state,
        ids: yield* allocateIds,
        now: DateTime.formatIso(now),
      });
      if (Result.isFailure(decided)) {
        return yield* eventSink.commitRejectedCommand({
          commandId: command.commandId,
          threadId: command.threadId,
          commandType: command.type,
          rejectedAt: now,
          error: decided.failure.reason,
        });
      }
      const { receipt } = yield* eventSink.commitCommand({
        commandId: command.commandId,
        threadId: command.threadId,
        commandType: command.type,
        acceptedAt: now,
        events: decided.success.events,
        effects: decided.success.effects,
        ...(decided.success.cancelUnsettledEffects === undefined
          ? {}
          : { cancelUnsettledEffects: decided.success.cancelUnsettledEffects }),
      });
      if (command.type === "queue.resume" && receipt.status === "accepted") {
        yield* startNextQueuedRun(command.threadId);
      }
      return receipt;
    });

  /** Starts the thread's next queued run, or holds the queue; call under the thread's lock. */
  const startNextQueuedRun = (threadId: ThreadId, failedRunId?: RunId) =>
    Effect.gen(function* () {
      const projection = yield* projections.getThread(threadId);
      if (Option.isNone(projection)) return;
      const ids = yield* allocateIds;
      const now = yield* DateTime.now;
      const decided = decideNextQueuedRun({
        projection: projection.value,
        ...(failedRunId === undefined ? {} : { failedRunId }),
        ids,
        now: DateTime.formatIso(now),
      });
      if (decided === undefined) return;
      const started = decided.effects.length > 0;
      yield* eventSink.commitCommand({
        commandId: CommandId.make(
          `command:system:${started ? "start-queued" : "hold-queue"}:${ids.effectId}`,
        ),
        threadId,
        commandType: started ? "queue.start-next" : "queue.hold",
        acceptedAt: now,
        events: decided.events,
        effects: decided.effects,
      });
    });

  // Each run that ends lets the next queued run start (T3 Code's
  // `handleTerminalRun`). Recovery's settlements are left alone: it holds
  // the queue itself.
  const latest = yield* eventStore.latestApplicationSequence;
  yield* eventStore.streamApplicationEvents({ afterSequence: latest }).pipe(
    Stream.runForEach((stored) => {
      if (
        stored.aggregateKind !== "thread" ||
        stored.event.type !== "run.updated" ||
        String(stored.commandId).startsWith("command:runtime-reconcile:")
      ) {
        return Effect.void;
      }
      const run = stored.event.payload;
      if (!TERMINAL_RUN_STATUSES.has(run.status)) return Effect.void;
      return threadLocks
        .withLock(
          run.threadId,
          startNextQueuedRun(run.threadId, run.status === "failed" ? run.id : undefined),
        )
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Starting the next queued run failed.").pipe(
              Effect.annotateLogs({ threadId: run.threadId, cause: String(cause) }),
            ),
          ),
        );
    }),
    Effect.forkScoped,
  );

  const dispatch = (command: OrchestrationV2Command) =>
    threadLocks.withLock(command.threadId, decideAndCommit(command)).pipe(
      Effect.mapError(
        (cause) => new OrchestratorDispatchError({ commandId: command.commandId, cause }),
      ),
      Effect.flatMap((receipt) => toOutcome(command, receipt)),
    );

  return OrchestratorV2.of({
    dispatch,
    getThreadProjection: projections.getThread,
  });
});

export const layer = Layer.effect(OrchestratorV2, make);

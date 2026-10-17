import { ManagedProjectFolders } from "../project/ManagedProjectFolders.ts";
import {
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

import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EventSink from "./EventSink.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import { decideThreadCommand, type ThreadCommandIds } from "./ThreadCommands.ts";

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
  const crypto = yield* Crypto.Crypto;
  const folders = yield* ManagedProjectFolders;
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
            }
          : { projection, projectExists: true, instanceHasAdapter: true };
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
      // Claim only after validation, under the command lock and after receipt lookup.
      // Persist before either outbox lane can start; a replay uses the same folder.
      const worktreePath =
        command.type === "message.dispatch" &&
        projection !== undefined &&
        projection.messages.length === 0 &&
        projection.thread.worktreePath == null
          ? yield* folders.folderForThread({
              projectId: projection.thread.projectId,
              threadId: command.threadId,
              text: command.text,
            })
          : Option.none<string>();
      const events = Option.isSome(worktreePath)
        ? decided.success.events.map((event) =>
            event.type === "thread.metadata-updated"
              ? { ...event, payload: { ...event.payload, worktreePath: worktreePath.value } }
              : event,
          )
        : decided.success.events;
      const { receipt } = yield* eventSink.commitCommand({
        commandId: command.commandId,
        threadId: command.threadId,
        commandType: command.type,
        acceptedAt: now,
        events,
        effects: decided.success.effects,
        ...(decided.success.cancelUnsettledEffects === undefined
          ? {}
          : { cancelUnsettledEffects: decided.success.cancelUnsettledEffects }),
      });
      return receipt;
    });

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

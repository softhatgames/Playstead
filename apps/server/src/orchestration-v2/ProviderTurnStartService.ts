import {
  ProviderSessionId,
  ProviderTurnId,
  RunId,
  type ThreadId,
  TurnItemId,
} from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2AppThread,
  OrchestrationV2ExecutionNode,
  OrchestrationV2ProviderFailure,
  OrchestrationV2Run,
  OrchestrationV2RunAttempt,
} from "@playstead/contracts/orchestrationV2";
import type { ProviderAdapterV2RuntimePolicy } from "@playstead/provider-core/server/ProviderAdapter";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as EventSink from "./EventSink.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as RunExecutionService from "./RunExecutionService.ts";

/**
 * Every thread runs in Full access with the default interaction mode, in its
 * project's folder (T3 Code's `RuntimePolicyV2.resolve` at 2577baf, with
 * nothing to choose).
 */
const resolveRuntimePolicy = (
  thread: OrchestrationV2AppThread,
  workspaceRoot: string,
): ProviderAdapterV2RuntimePolicy => ({
  runtimeMode: thread.runtimeMode,
  interactionMode: thread.interactionMode,
  cwd: workspaceRoot,
});

/** A run that never reached its provider ends failed, with the reason as its last item. */
const unstartedRunFailureEvents = (
  records: {
    readonly run: OrchestrationV2Run;
    readonly attempt: OrchestrationV2RunAttempt;
    readonly rootNode: OrchestrationV2ExecutionNode;
  },
  failure: OrchestrationV2ProviderFailure,
  now: string,
): ReadonlyArray<EventSink.NewDomainEvent> => {
  const base = { threadId: records.run.threadId, runId: records.run.id, occurredAt: now };
  return [
    {
      ...base,
      type: "turn-item.updated",
      payload: {
        id: TurnItemId.make(`item:${records.run.id}:start-failure`),
        threadId: records.run.threadId,
        runId: records.run.id,
        nodeId: records.rootNode.id,
        providerThreadId: records.attempt.providerThreadId,
        providerTurnId: null,
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
    {
      ...base,
      type: "run-attempt.updated",
      payload: { ...records.attempt, status: "failed", completedAt: now },
    },
    {
      ...base,
      type: "node.updated",
      payload: { ...records.rootNode, status: "failed", completedAt: now },
    },
    {
      ...base,
      type: "run.updated",
      payload: { ...records.run, status: "failed", completedAt: now },
    },
  ];
};

export class ProviderTurnStartError extends Schema.TaggedError<ProviderTurnStartError>()(
  "ProviderTurnStartError",
  { runId: RunId, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Run ${this.runId} could not start.`;
  }
}

/**
 * Starts a run's provider turn, the effect worker's `provider-turn.start`
 * (T3 Code's `apps/server/src/orchestration-v2/ProviderTurnStartService.ts`
 * at 2577baf): it opens or reuses the thread's provider session, marks the
 * run and everything under it running, and hands the turn to the run
 * execution. A run that is no longer starting is left alone, so a repeated
 * effect does nothing.
 */
export class ProviderTurnStartServiceV2 extends Context.Service<
  ProviderTurnStartServiceV2,
  {
    readonly start: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
    }) => Effect.Effect<void, ProviderTurnStartError>;
  }
>()("@playstead/server/orchestration-v2/ProviderTurnStartService/ProviderTurnStartServiceV2") {}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const adapters = yield* ProviderAdapterRegistry.ProviderAdapterRegistryV2;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const runs = yield* RunExecutionService.RunExecutionServiceV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const crypto = yield* Crypto.Crypto;

  const start = (input: { readonly threadId: ThreadId; readonly runId: RunId }) =>
    Effect.gen(function* () {
      const projection = Option.getOrUndefined(yield* projections.getThread(input.threadId));
      const run = projection?.runs.find((candidate) => candidate.id === input.runId);
      if (projection === undefined || run === undefined || run.status !== "starting") return;
      const attempt = projection.attempts.find((candidate) => candidate.id === run.activeAttemptId);
      const rootNode = projection.nodes.find((candidate) => candidate.id === run.rootNodeId);
      const providerThread = projection.providerThreads.find(
        (candidate) => candidate.id === run.providerThreadId,
      );
      const userMessage = projection.messages.find((message) => message.id === run.userMessageId);
      if (
        attempt === undefined ||
        rootNode === undefined ||
        providerThread === undefined ||
        userMessage === undefined
      ) {
        return yield* Effect.die(`Run ${run.id} is missing its attempt, root node or message.`);
      }
      const { thread } = projection;

      const fail = (detail: string) =>
        Effect.flatMap(DateTime.now, (now) =>
          eventSink.write(
            unstartedRunFailureEvents(
              { run, attempt, rootNode },
              RunExecutionService.failureFrom(detail),
              DateTime.formatIso(now),
            ),
          ),
        );

      const project = yield* projects.get(thread.projectId);
      if (Option.isNone(project)) {
        return yield* fail(`Project ${thread.projectId} no longer exists.`);
      }
      const adapter = yield* adapters.get(thread.providerInstanceId);
      if (Option.isNone(adapter)) {
        return yield* fail(`Provider instance ${thread.providerInstanceId} cannot run threads.`);
      }
      const runtimePolicy = resolveRuntimePolicy(thread, project.value.workspaceRoot);
      // A provider thread that has had turns continues its native
      // conversation, as T3 Code resumes one with a persisted turn.
      const earlierTurns = projection.providerTurns.filter(
        (turn) => turn.providerThreadId === providerThread.id,
      ).length;
      const initialNativeThreadId =
        earlierTurns > 0 ? providerThread.nativeThreadRef?.nativeId : undefined;

      const opened = yield* sessions
        .open({
          threadId: thread.id,
          adapter: adapter.value,
          providerSessionId: ProviderSessionId.make(
            `provider-session:${yield* crypto.randomUUIDv4()}`,
          ),
          modelSelection: run.modelSelection,
          runtimePolicy,
          ...(initialNativeThreadId === undefined ? {} : { initialNativeThreadId }),
        })
        .pipe(Effect.result);
      if (opened._tag === "Failure") return yield* fail(opened.failure.message);
      const { session } = opened.success;

      const readyThread = yield* session.ensureThread({ providerThread }).pipe(Effect.result);
      if (readyThread._tag === "Failure") return yield* fail(readyThread.failure.message);

      const now = DateTime.formatIso(yield* DateTime.now);
      const providerTurnId = ProviderTurnId.make(`provider-turn:${yield* crypto.randomUUIDv4()}`);
      const turnOrdinal =
        projection.providerTurns.filter((turn) => turn.providerThreadId === providerThread.id)
          .length + 1;
      const records: RunExecutionService.RootRunRecords = {
        run: { ...run, status: "running", startedAt: now },
        attempt: { ...attempt, status: "running", providerTurnId, startedAt: now },
        rootNode: { ...rootNode, status: "running", providerTurnId, startedAt: now },
        // The adapter runs the turn with the run's model, changing the session's if needed.
        providerSession: {
          ...session.providerSession,
          model: run.modelSelection.model,
          status: "running",
          updatedAt: now,
        },
        providerThread: {
          ...readyThread.success,
          providerSessionId: session.providerSession.id,
          status: "active",
          lastRunOrdinal: run.ordinal,
          updatedAt: now,
        },
        providerTurn: {
          id: providerTurnId,
          providerThreadId: providerThread.id,
          nodeId: rootNode.id,
          runAttemptId: attempt.id,
          ordinal: turnOrdinal,
          status: "running",
          startedAt: now,
          completedAt: null,
        },
      };
      const base = { threadId: thread.id, runId: run.id, occurredAt: now };
      yield* eventSink.write([
        { ...base, type: "provider-session.updated", payload: records.providerSession },
        { ...base, type: "provider-thread.updated", payload: records.providerThread },
        { ...base, type: "provider-turn.updated", payload: records.providerTurn },
        { ...base, type: "run-attempt.updated", payload: records.attempt },
        { ...base, type: "node.updated", payload: records.rootNode },
        { ...base, type: "run.updated", payload: records.run },
      ]);

      yield* runs.startRootRun({
        session,
        records,
        turn: {
          threadId: thread.id,
          runId: run.id,
          runOrdinal: run.ordinal,
          attemptId: attempt.id,
          rootNodeId: rootNode.id,
          providerThread: records.providerThread,
          providerTurnId,
          message: { messageId: userMessage.id, text: userMessage.text },
          modelSelection: run.modelSelection,
          runtimePolicy,
        },
      });
    }).pipe(Effect.mapError((cause) => new ProviderTurnStartError({ runId: input.runId, cause })));

  return ProviderTurnStartServiceV2.of({ start });
});

export const layer = Layer.effect(ProviderTurnStartServiceV2, make);

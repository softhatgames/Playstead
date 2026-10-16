import type {
  MessageId,
  NodeId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  TurnItemId,
} from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2AppThread,
  type OrchestrationV2Command,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
} from "@playstead/contracts/orchestrationV2";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { PendingEffect } from "./EffectOutbox.ts";
import type { NewDomainEvent } from "./EventSink.ts";

/** Why a thread command was refused; the reason is kept in its receipt. */
export class ThreadCommandRejection extends Schema.TaggedError<ThreadCommandRejection>()(
  "ThreadCommandRejection",
  { commandType: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/** What a command is decided against, read under the thread's lock. */
export interface ThreadCommandState {
  readonly projection: OrchestrationV2ThreadProjection | undefined;
  /** For `thread.create`: whether the project exists. */
  readonly projectExists: boolean;
  /** For `thread.create`: whether the provider instance can run a thread. */
  readonly instanceHasAdapter: boolean;
}

/** Ids a message needs, allocated before deciding so the decision stays pure. */
export interface ThreadCommandIds {
  readonly runId: RunId;
  readonly attemptId: RunAttemptId;
  readonly rootNodeId: NodeId;
  readonly providerThreadId: ProviderThreadId;
  readonly userItemId: TurnItemId;
  readonly effectId: string;
}

export interface ThreadCommandDecision {
  readonly events: ReadonlyArray<NewDomainEvent>;
  readonly effects: ReadonlyArray<PendingEffect>;
}

const reject = (command: OrchestrationV2Command, reason: string) =>
  Result.fail(new ThreadCommandRejection({ commandType: command.type, reason }));

/**
 * Decides a thread command's events and effects, without I/O. T3 Code at
 * 2577baf decides inside `OrchestratorV2`'s `dispatchThreadCreate` and
 * `dispatchMessage` (`apps/server/src/orchestration-v2/Orchestrator.ts`);
 * Playstead keeps the same events in the same order as a pure function.
 *
 * - `thread.create` makes a thread in Full access and the default
 *   interaction mode, for an existing project and an instance that can run it.
 * - `message.dispatch` starts a run at once. T3 Code queues a message sent
 *   while a run is active; Playstead has no queue and refuses it.
 */
export function decideThreadCommand(input: {
  readonly command: OrchestrationV2Command;
  readonly state: ThreadCommandState;
  readonly ids: ThreadCommandIds;
  readonly now: string;
}): Result.Result<ThreadCommandDecision, ThreadCommandRejection> {
  const { command, state, ids, now } = input;
  switch (command.type) {
    case "thread.create": {
      if (state.projection !== undefined) {
        return reject(command, `Thread ${command.threadId} already exists.`);
      }
      if (!state.projectExists) {
        return reject(command, `Project ${command.projectId} does not exist.`);
      }
      if (!state.instanceHasAdapter) {
        return reject(
          command,
          `Provider instance ${command.modelSelection.instanceId} cannot run threads yet.`,
        );
      }
      const thread: OrchestrationV2AppThread = {
        id: command.threadId,
        projectId: command.projectId,
        title: command.title,
        providerInstanceId: command.modelSelection.instanceId,
        modelSelection: command.modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        activeProviderThreadId: null,
        createdAt: now,
        updatedAt: now,
      };
      return Result.succeed({
        events: [{ type: "thread.created", threadId: thread.id, occurredAt: now, payload: thread }],
        effects: [],
      });
    }
    case "message.dispatch": {
      const projection = state.projection;
      if (projection === undefined) {
        return reject(command, `Thread ${command.threadId} does not exist.`);
      }
      const active = projection.runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status));
      if (active !== undefined) {
        return reject(
          command,
          `Thread ${command.threadId} is still working on run ${active.id}. Wait for it to finish before sending another message.`,
        );
      }
      return Result.succeed(dispatchMessage(command, projection, ids, now));
    }
  }
}

function dispatchMessage(
  command: Extract<OrchestrationV2Command, { type: "message.dispatch" }>,
  projection: OrchestrationV2ThreadProjection,
  ids: ThreadCommandIds,
  now: string,
): ThreadCommandDecision {
  const { thread } = projection;
  const threadId = thread.id;
  const runId = ids.runId;
  const ordinal = projection.runs.reduce((highest, run) => Math.max(highest, run.ordinal), 0) + 1;
  const events: Array<NewDomainEvent> = [];

  // The first message titles the thread, as T3 Code's title seed does.
  const titled =
    command.titleSeed !== undefined && projection.messages.length === 0
      ? command.titleSeed
      : thread.title;

  const existingProviderThread = projection.providerThreads.find(
    (providerThread) => providerThread.id === thread.activeProviderThreadId,
  );
  const providerThread: OrchestrationV2ProviderThread = existingProviderThread ?? {
    id: ids.providerThreadId,
    driver: thread.providerInstanceId,
    providerInstanceId: thread.providerInstanceId,
    providerSessionId: null,
    appThreadId: threadId,
    nativeThreadRef: null,
    status: "not_loaded",
    firstRunOrdinal: ordinal,
    lastRunOrdinal: null,
    createdAt: now,
    updatedAt: now,
  };

  if (titled !== thread.title || existingProviderThread === undefined) {
    events.push({
      type: "thread.metadata-updated",
      threadId,
      occurredAt: now,
      payload: {
        ...thread,
        title: titled,
        activeProviderThreadId: providerThread.id,
        updatedAt: now,
      },
    });
  }
  if (existingProviderThread === undefined) {
    events.push({
      type: "provider-thread.updated",
      threadId,
      runId,
      occurredAt: now,
      payload: providerThread,
    });
  }

  const run: OrchestrationV2Run = {
    id: runId,
    threadId,
    ordinal,
    providerInstanceId: thread.providerInstanceId,
    modelSelection: thread.modelSelection,
    providerThreadId: providerThread.id,
    userMessageId: command.messageId as MessageId,
    rootNodeId: ids.rootNodeId,
    activeAttemptId: ids.attemptId,
    status: "starting",
    requestedAt: now,
    startedAt: null,
    completedAt: null,
  };
  events.push(
    { type: "run.created", threadId, runId, occurredAt: now, payload: run },
    {
      type: "run-attempt.created",
      threadId,
      runId,
      occurredAt: now,
      payload: {
        id: ids.attemptId,
        runId,
        attemptOrdinal: 1,
        rootNodeId: ids.rootNodeId,
        providerInstanceId: thread.providerInstanceId,
        providerThreadId: providerThread.id,
        providerTurnId: null,
        reason: "initial",
        status: "pending",
        startedAt: null,
        completedAt: null,
      },
    },
    {
      type: "node.updated",
      threadId,
      runId,
      occurredAt: now,
      payload: {
        id: ids.rootNodeId,
        threadId,
        runId,
        parentNodeId: null,
        rootNodeId: ids.rootNodeId,
        kind: "root_turn",
        status: "pending",
        providerThreadId: providerThread.id,
        providerTurnId: null,
        startedAt: null,
        completedAt: null,
      },
    },
    {
      type: "message.updated",
      threadId,
      runId,
      occurredAt: now,
      payload: {
        id: command.messageId,
        threadId,
        runId,
        nodeId: ids.rootNodeId,
        role: "user",
        text: command.text,
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    },
    {
      type: "turn-item.updated",
      threadId,
      runId,
      occurredAt: now,
      payload: {
        id: ids.userItemId,
        threadId,
        runId,
        nodeId: ids.rootNodeId,
        providerThreadId: providerThread.id,
        providerTurnId: null,
        ordinal: 0,
        status: "completed",
        title: null,
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        type: "user_message",
        messageId: command.messageId,
        text: command.text,
      },
    },
  );

  return {
    events,
    effects: [{ id: ids.effectId, request: { type: "provider-turn.start", runId } }],
  };
}

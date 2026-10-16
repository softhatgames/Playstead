import {
  type MessageId,
  type NodeId,
  type ProviderThreadId,
  type RunAttemptId,
  type RunId,
  TurnItemId,
} from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2AppThread,
  type OrchestrationV2Command,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@playstead/contracts/orchestrationV2";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { CancelUnsettledEffects, PendingEffect } from "./EffectOutbox.ts";
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
  /** The thread's effects the command makes moot, cancelled in its commit. */
  readonly cancelUnsettledEffects?: CancelUnsettledEffects;
}

/**
 * The interrupt's two turn items, one pair per run (T3 Code's
 * `runSignalTurnItem` ids): the request, and the result that names it.
 */
export const interruptRequestItemId = (runId: RunId) =>
  TurnItemId.make(`item:${runId}:interrupt-request`);
const interruptResultItemId = (runId: RunId) => TurnItemId.make(`item:${runId}:interrupt-result`);

/** The item that marks a run interrupted, as T3 Code's `makeInterruptResultTurnItem` builds it. */
export const interruptResultItem = (input: {
  readonly run: OrchestrationV2Run;
  readonly providerTurnId: OrchestrationV2TurnItem["providerTurnId"];
  readonly message: string;
  readonly now: string;
}): OrchestrationV2TurnItem => ({
  id: interruptResultItemId(input.run.id),
  threadId: input.run.threadId,
  runId: input.run.id,
  nodeId: input.run.rootNodeId,
  providerThreadId: input.run.providerThreadId,
  providerTurnId: input.providerTurnId,
  ordinal: 0,
  status: "interrupted",
  title: "Interrupted",
  startedAt: input.now,
  completedAt: input.now,
  updatedAt: input.now,
  type: "run_interrupt_result",
  message: input.message,
  parentItemId: interruptRequestItemId(input.run.id),
});

const reject = (command: OrchestrationV2Command, reason: string) =>
  Result.fail(new ThreadCommandRejection({ commandType: command.type, reason }));

/**
 * Decides a thread command's events and effects, without I/O. T3 Code at
 * 2577baf decides inside `OrchestratorV2`'s `dispatchThreadCreate`,
 * `dispatchThreadMutation` and `dispatchMessage`
 * (`apps/server/src/orchestration-v2/Orchestrator.ts`); Playstead keeps the
 * same events in the same order as a pure function.
 *
 * - `thread.create` makes a thread in Full access and the default
 *   interaction mode, for an existing project and an instance that can run it.
 * - `thread.model-selection.set` changes the model the thread's next run
 *   copies. Naming another instance is T3 Code's provider switch, which
 *   Playstead refuses.
 * - `message.dispatch` starts a run at once. T3 Code queues a message sent
 *   while a run is active; Playstead has no queue and refuses it.
 * - `run.interrupt` stops an active run, as T3 Code's `dispatchRunInterrupt`
 *   does: a run whose provider turn has not started ends interrupted at
 *   once and its start is cancelled; otherwise the provider is asked to
 *   stop, and the run ends when its turn does.
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
    case "thread.model-selection.set": {
      const projection = state.projection;
      if (projection === undefined) {
        return reject(command, `Thread ${command.threadId} does not exist.`);
      }
      const { thread } = projection;
      if (command.modelSelection.instanceId !== thread.providerInstanceId) {
        return reject(
          command,
          `Thread ${thread.id} runs on ${thread.providerInstanceId}. Choose one of its models; switching provider is not available yet.`,
        );
      }
      return Result.succeed({
        events: [
          {
            type: "thread.model-selection-updated",
            threadId: thread.id,
            occurredAt: now,
            payload: { ...thread, modelSelection: command.modelSelection, updatedAt: now },
          },
        ],
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
    case "run.interrupt": {
      const projection = state.projection;
      if (projection === undefined) {
        return reject(command, `Thread ${command.threadId} does not exist.`);
      }
      const run = projection.runs.find((candidate) => candidate.id === command.runId);
      if (run === undefined) {
        return reject(command, `Run ${command.runId} is not in thread ${command.threadId}.`);
      }
      if (!ACTIVE_RUN_STATUSES.has(run.status)) {
        return reject(command, `Run ${run.id} has already ended ${run.status}.`);
      }
      const requestId = interruptRequestItemId(run.id);
      if (projection.turnItems.some((item) => item.id === requestId)) {
        return reject(command, `Run ${run.id} is already being interrupted.`);
      }
      return Result.succeed(dispatchRunInterrupt(projection, run, ids, now));
    }
  }
}

function dispatchRunInterrupt(
  projection: OrchestrationV2ThreadProjection,
  run: OrchestrationV2Run,
  ids: ThreadCommandIds,
  now: string,
): ThreadCommandDecision {
  const base = { threadId: run.threadId, runId: run.id, occurredAt: now };
  const providerTurn = projection.providerTurns.find(
    (turn) => turn.runAttemptId === run.activeAttemptId && turn.status === "running",
  );
  const request: OrchestrationV2TurnItem = {
    id: interruptRequestItemId(run.id),
    threadId: run.threadId,
    runId: run.id,
    nodeId: run.rootNodeId,
    providerThreadId: run.providerThreadId,
    providerTurnId: providerTurn?.id ?? null,
    ordinal: 0,
    status: "completed",
    title: "Interrupt requested",
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    type: "run_interrupt_request",
    message: "Interrupt requested",
  };
  const requested: NewDomainEvent = { ...base, type: "turn-item.updated", payload: request };

  if (providerTurn !== undefined) {
    return {
      events: [requested],
      effects: [
        {
          id: ids.effectId,
          request: {
            type: "provider-turn.interrupt",
            runId: run.id,
            providerTurnId: providerTurn.id,
          },
        },
      ],
    };
  }

  // Nothing reached the provider yet: the run ends here, and its start is cancelled.
  const attempt = projection.attempts.find((candidate) => candidate.id === run.activeAttemptId);
  const rootNode = projection.nodes.find((candidate) => candidate.id === run.rootNodeId);
  return {
    events: [
      requested,
      {
        ...base,
        type: "turn-item.updated",
        payload: interruptResultItem({
          run,
          providerTurnId: null,
          message: "Run interrupted before the provider started",
          now,
        }),
      },
      ...(attempt === undefined
        ? []
        : [
            {
              ...base,
              type: "run-attempt.updated",
              payload: { ...attempt, status: "interrupted", completedAt: now },
            } as const,
          ]),
      ...(rootNode === undefined
        ? []
        : [
            {
              ...base,
              type: "node.updated",
              payload: { ...rootNode, status: "interrupted", completedAt: now },
            } as const,
          ]),
      {
        ...base,
        type: "run.updated",
        payload: { ...run, status: "interrupted", completedAt: now },
      },
    ],
    effects: [],
    cancelUnsettledEffects: {
      effectTypes: ["provider-turn.start"],
      reason: `Run ${run.id} was interrupted before its provider turn started.`,
    },
  };
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

import {
  type CommandId,
  type MessageId,
  type NodeId,
  type ProviderSessionId,
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
  type OrchestrationV2ServerCommand,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  QUEUED_RUN_STATUSES,
} from "@playstead/contracts/orchestrationV2";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { CancelUnsettledEffects, PendingEffect } from "./EffectOutbox.ts";
import type { NewDomainEvent } from "./EventSink.ts";
import { detachProviderSessions } from "./ProviderSessionDetach.ts";
import { planThreadDeletion } from "./ThreadDeletion.ts";

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

const reject = (command: OrchestrationV2ServerCommand, reason: string) =>
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
 *   while a run is active; Playstead has no queue and refuses it. The first
 *   message titles the thread with its seed and asks a provider for a title.
 * - `run.interrupt` stops an active run, as T3 Code's `dispatchRunInterrupt`
 *   does: a run whose provider turn has not started ends interrupted at
 *   once and its start is cancelled; otherwise the provider is asked to
 *   stop, and the run ends when its turn does.
 * - `runtime-request.respond` answers a question still pending and
 *   answerable, once every question has an answer; the provider is given
 *   the answers. There are no approval decisions.
 * - `thread.archive`, `thread.unarchive`, `thread.model-selection.set`,
 *   `thread.metadata.update`, `thread.mark-unread`, `thread.pin`,
 *   `thread.unpin`, `thread.settle`, `thread.unsettle`, `thread.snooze`,
 *   `thread.unsnooze`, `thread.auto-settle.set` and the internal
 *   `thread.title.regeneration.complete` change the thread itself, through
 *   `dispatchThreadMutation`.
 * - The internal `thread.auto-settle` settles the thread for the settlement
 *   sweep, unless it changed since the sweep read it (T3 Code's
 *   `thread.auto-settle` case in `dispatchCommand`).
 * - `thread.visit` moves the read marker forward (`dispatchThreadVisit`).
 * - `thread.delete` deletes the thread (`planThreadDeletion`).
 *
 * Every command but `thread.create` needs the thread, and a deleted thread
 * refuses them all.
 */
export function decideThreadCommand(input: {
  readonly command: OrchestrationV2ServerCommand;
  readonly state: ThreadCommandState;
  readonly ids: ThreadCommandIds;
  readonly now: string;
}): Result.Result<ThreadCommandDecision, ThreadCommandRejection> {
  const { command, state, ids, now } = input;
  if (command.type === "thread.create") {
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
      archivedAt: null,
      deletedAt: null,
      lastVisitedAt: null,
      settledOverride: null,
      settledAt: null,
      unsettledAt: null,
      pinnedAt: null,
      pinOrderKey: null,
      activeOrderKey: null,
      snoozedUntil: null,
      snoozedAt: null,
      lastSnoozeWakeAt: null,
      autoSettleDisabledAt: null,
      titleRegeneration: null,
    };
    return Result.succeed({
      events: [{ type: "thread.created", threadId: thread.id, occurredAt: now, payload: thread }],
      effects: [],
    });
  }
  const projection = state.projection;
  if (projection === undefined) {
    return reject(command, `Thread ${command.threadId} does not exist.`);
  }
  if (projection.thread.deletedAt !== null) {
    return reject(command, `Thread ${command.threadId} is deleted.`);
  }
  switch (command.type) {
    case "thread.model-selection.set":
    case "thread.archive":
    case "thread.unarchive":
    case "thread.metadata.update":
    case "thread.mark-unread":
    case "thread.pin":
    case "thread.unpin":
    case "thread.pin.reorder":
    case "thread.active.reorder":
    case "thread.settle":
    case "thread.unsettle":
    case "thread.snooze":
    case "thread.unsnooze":
    case "thread.auto-settle.set":
    case "thread.title.regeneration.complete":
      return dispatchThreadMutation(command, projection, now);
    case "thread.auto-settle": {
      // The sweep decided on what it read; any change since, or any override
      // the person set (an un-settle's "active" too), wins over it.
      const { thread } = projection;
      if (
        thread.settledOverride !== null ||
        DateTime.toEpochMillis(DateTime.makeUnsafe(thread.updatedAt)) >
          DateTime.toEpochMillis(DateTime.makeUnsafe(command.snapshotAt))
      ) {
        return reject(command, `Thread ${thread.id} changed before automatic settlement.`);
      }
      return dispatchThreadMutation(
        {
          type: "thread.settle",
          commandId: command.commandId,
          threadId: command.threadId,
          ...(command.settledAt === undefined ? {} : { settledAt: command.settledAt }),
        },
        projection,
        now,
      );
    }
    case "thread.visit":
      return Result.succeed(dispatchThreadVisit(command, projection, now));
    case "thread.delete":
      return Result.succeed(planThreadDeletion({ command, projection, now }));
    case "message.dispatch": {
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
    case "runtime-request.respond": {
      const request = projection.runtimeRequests.find(
        (candidate) => candidate.id === command.requestId,
      );
      if (request === undefined) {
        return reject(command, `Runtime request ${command.requestId} was not found.`);
      }
      if (request.status !== "pending") {
        return reject(command, `Runtime request ${request.id} is ${request.status}.`);
      }
      if (request.responseCapability.type === "not_resumable") {
        return reject(command, request.responseCapability.reason);
      }
      const item = projection.turnItems.find(
        (candidate) =>
          candidate.type === "user_input_request" && candidate.requestId === request.id,
      );
      if (item?.type !== "user_input_request" || item.runId === null) {
        return reject(command, `The question for runtime request ${request.id} was not found.`);
      }
      const unanswered = item.questions.some((question) => {
        const answer = command.answers[question.id];
        return typeof answer === "string"
          ? answer.trim().length === 0
          : answer === undefined || answer.length === 0;
      });
      if (unanswered) return reject(command, "Answer each question before sending.");
      return Result.succeed(
        dispatchRuntimeRequestRespond(
          command,
          projection,
          request,
          item,
          request.responseCapability.providerSessionId,
          item.runId,
          ids,
          now,
        ),
      );
    }
  }
}

/** The commands that change the thread itself, decided by `dispatchThreadMutation`. */
type ThreadMutationCommand = Extract<
  OrchestrationV2ServerCommand,
  {
    readonly type:
      | "thread.model-selection.set"
      | "thread.archive"
      | "thread.unarchive"
      | "thread.metadata.update"
      | "thread.mark-unread"
      | "thread.pin"
      | "thread.unpin"
      | "thread.pin.reorder"
      | "thread.active.reorder"
      | "thread.settle"
      | "thread.unsettle"
      | "thread.snooze"
      | "thread.unsnooze"
      | "thread.auto-settle.set"
      | "thread.title.regeneration.complete";
  }
>;

/**
 * The effect that has a provider write the thread's title (T3 Code's
 * `pendingThreadTitleGenerationEffect`): one per command, so a command sent
 * again adds none.
 */
const threadTitleGenerationEffect = (
  commandId: CommandId,
  kind:
    | { readonly type: "initial"; readonly messageId: MessageId }
    | { readonly type: "regenerate" },
): PendingEffect => ({
  id: `effect:${commandId}:thread-title.generate`,
  request: { type: "thread-title.generate", kind },
});

/**
 * The commands an archived thread refuses (T3 Code's list).
 */
const REFUSED_WHILE_ARCHIVED: ReadonlySet<ThreadMutationCommand["type"]> = new Set([
  "thread.pin",
  "thread.unpin",
  "thread.pin.reorder",
  "thread.active.reorder",
  "thread.settle",
  "thread.unsettle",
  "thread.snooze",
  "thread.unsnooze",
  "thread.auto-settle.set",
]);

/**
 * Why the thread cannot be snoozed until `snoozedUntil`, or null (T3 Code's
 * snooze guard): the time must be ahead, and nothing may wait on the person,
 * neither a pending request nor a message in the queue. T3 Code lets a
 * queued automatic message through (a notification or a delegated
 * completion); Playstead sends none, so every queued run blocks once slice 1
 * brings the queue.
 */
function snoozeBlocker(
  projection: OrchestrationV2ThreadProjection,
  snoozedUntil: string,
  now: string,
): string | null {
  const wakeAt = Date.parse(snoozedUntil);
  if (Number.isNaN(wakeAt) || wakeAt <= Date.parse(now)) {
    return `snooze wake time ${snoozedUntil} is not in the future.`;
  }
  if (projection.runtimeRequests.some((request) => request.status === "pending")) {
    return "has a pending approval or user-input request and cannot be snoozed.";
  }
  if (projection.runs.some((run) => QUEUED_RUN_STATUSES.has(run.status))) {
    return "has a queued run and cannot be snoozed.";
  }
  return null;
}

/**
 * Why the thread cannot be settled now, or null (T3 Code's settle guard):
 * a provider waiting on the person, a run still working, or a message
 * waiting in the queue. T3 Code lets a question answerable by a later
 * message through, and cancels it; every question Playstead's providers ask
 * is answered live, so each one blocks. Approvals and the queue arrive with
 * slice 1 (permission modes and turn control) and fall under the same rules:
 * a pending request of any kind blocks, and so does a run in
 * `QUEUED_RUN_STATUSES`.
 */
function settleBlocker(projection: OrchestrationV2ThreadProjection): string | null {
  if (projection.runtimeRequests.some((request) => request.status === "pending")) {
    return "is waiting on an approval or question. Answer it before settling.";
  }
  if (projection.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status))) {
    return "is still running. Stop it before settling.";
  }
  if (projection.runs.some((run) => QUEUED_RUN_STATUSES.has(run.status))) {
    return "has a queued message. Send it or remove it from the queue before settling.";
  }
  return null;
}

/**
 * The one handler for every command that changes the thread itself (T3 Code's
 * `dispatchThreadMutation` in `apps/server/src/orchestration-v2/Orchestrator.ts`
 * at 2577baf): it checks the command's rules, writes the whole updated thread
 * in the command's own event, and then does what the change brings with it.
 *
 * - `thread.model-selection.set` changes the model the next run copies;
 *   naming another instance is T3 Code's provider switch, which Playstead
 *   refuses.
 * - `thread.archive` is refused for an archived thread. It is not refused
 *   while a run is active (the interface blocks that instead); it cancels
 *   queued runs with their attempts and nodes, detaches every live
 *   provider session and drops a title being generated.
 * - `thread.unarchive` is refused for a thread that is not archived.
 * - `thread.metadata.update` renames the thread, which drops a title being
 *   generated. With `regenerateTitle` it asks a provider for a new title
 *   instead (false only drops the pending one).
 * - `thread.title.regeneration.complete` ends a title request: while it is
 *   still the thread's, the generated title (if any) replaces the current
 *   one; otherwise the thread stays as it is.
 * - `thread.mark-unread` moves the read marker to just before the latest
 *   run completed, so the thread shows as unread; it is refused until a run
 *   has completed. Like a visit, it is not activity: `updatedAt` stays.
 * - `thread.pin` pins the thread, keeping the order key of its first pin;
 *   a settled thread comes back to active work, and a snoozed one wakes.
 * - `thread.unpin` drops the pin and its order key.
 * - `thread.settle` is refused while `settleBlocker` says so. It drops the
 *   pin and both order keys, and detaches every live provider session
 *   ("Thread settled."); settling a settled thread keeps its time.
 * - `thread.unsettle` brings the thread back to active work and holds it
 *   there, so automatic settlement leaves it alone until a message.
 * - `thread.snooze` is refused while `snoozeBlocker` says so. Snoozing again
 *   until the same time keeps when it was first snoozed.
 * - `thread.unsnooze` wakes the thread and stamps `lastSnoozeWakeAt`; an
 *   awake thread stays as it is.
 * - `thread.auto-settle.set` turns automatic settlement off for the thread
 *   (keeping the first time it was turned off) or back on.
 *
 * An archived thread refuses the commands in `REFUSED_WHILE_ARCHIVED`.
 */
function dispatchThreadMutation(
  command: ThreadMutationCommand,
  projection: OrchestrationV2ThreadProjection,
  now: string,
): Result.Result<ThreadCommandDecision, ThreadCommandRejection> {
  const { thread } = projection;
  if (command.type === "thread.archive" && thread.archivedAt !== null) {
    return reject(command, `Thread ${thread.id} is already archived.`);
  }
  if (command.type === "thread.unarchive" && thread.archivedAt === null) {
    return reject(command, `Thread ${thread.id} is not archived.`);
  }
  if (REFUSED_WHILE_ARCHIVED.has(command.type) && thread.archivedAt !== null) {
    return reject(command, `Thread ${thread.id} is archived.`);
  }
  // Only a pinned thread has a place among the pins: refusing, rather than
  // pinning, keeps a reorder that raced an unpin from bringing the pin back.
  if (command.type === "thread.pin.reorder" && thread.pinnedAt === null) {
    return reject(command, `Thread ${thread.id} is not pinned and cannot be reordered.`);
  }
  if (
    command.type === "thread.active.reorder" &&
    (thread.pinnedAt !== null || thread.settledOverride === "settled")
  ) {
    return reject(command, `Thread ${thread.id} is not active and cannot be reordered.`);
  }
  if (
    command.type === "thread.model-selection.set" &&
    command.modelSelection.instanceId !== thread.providerInstanceId
  ) {
    return reject(
      command,
      `Thread ${thread.id} runs on ${thread.providerInstanceId}. Choose one of its models; switching provider is not available yet.`,
    );
  }
  let markUnreadVisitedAt: string | null = null;
  if (command.type === "thread.mark-unread") {
    const latestRunCompletedAt = latestRunOf(projection.runs)?.completedAt ?? null;
    if (latestRunCompletedAt === null) {
      return reject(command, `Thread ${thread.id} has no completed run to mark unread.`);
    }
    markUnreadVisitedAt = DateTime.formatIso(
      DateTime.subtract(DateTime.makeUnsafe(latestRunCompletedAt), { milliseconds: 1 }),
    );
  }
  if (command.type === "thread.settle") {
    const blocker = settleBlocker(projection);
    if (blocker !== null) return reject(command, `Thread ${thread.id} ${blocker}`);
  }
  if (command.type === "thread.snooze") {
    const blocker = snoozeBlocker(projection, command.snoozedUntil, now);
    if (blocker !== null) return reject(command, `Thread ${thread.id} ${blocker}`);
  }

  const updated: OrchestrationV2AppThread = (() => {
    switch (command.type) {
      case "thread.model-selection.set":
        return { ...thread, modelSelection: command.modelSelection, updatedAt: now };
      case "thread.archive":
        return { ...thread, archivedAt: now, titleRegeneration: null, updatedAt: now };
      case "thread.unarchive":
        return { ...thread, archivedAt: null, updatedAt: now };
      case "thread.metadata.update":
        return {
          ...thread,
          ...(command.title === undefined ? {} : { title: command.title }),
          ...(command.regenerateTitle === true
            ? { titleRegeneration: { requestId: command.commandId, startedAt: now } }
            : command.regenerateTitle === false || command.title !== undefined
              ? { titleRegeneration: null }
              : {}),
          updatedAt: now,
        };
      case "thread.title.regeneration.complete":
        return thread.titleRegeneration?.requestId === command.requestId
          ? {
              ...thread,
              ...(command.title === undefined ? {} : { title: command.title }),
              titleRegeneration: null,
              updatedAt: now,
            }
          : thread;
      case "thread.mark-unread":
        return { ...thread, lastVisitedAt: markUnreadVisitedAt };
      case "thread.pin": {
        const alreadyPinned = thread.pinnedAt !== null;
        const settled = thread.settledOverride === "settled";
        const snoozed = thread.snoozedUntil !== null;
        return {
          ...thread,
          pinnedAt: alreadyPinned ? thread.pinnedAt : now,
          ...(alreadyPinned || command.orderKey === undefined
            ? {}
            : { pinOrderKey: command.orderKey }),
          settledOverride: settled ? "active" : thread.settledOverride,
          settledAt: settled ? null : thread.settledAt,
          snoozedUntil: null,
          snoozedAt: null,
          lastSnoozeWakeAt: snoozed ? now : thread.lastSnoozeWakeAt,
          updatedAt: alreadyPinned && !settled && !snoozed ? thread.updatedAt : now,
        };
      }
      case "thread.unpin":
        return {
          ...thread,
          pinnedAt: null,
          pinOrderKey: null,
          updatedAt: thread.pinnedAt === null ? thread.updatedAt : now,
        };
      case "thread.pin.reorder":
        return {
          ...thread,
          pinOrderKey: command.orderKey,
          updatedAt: thread.pinOrderKey === command.orderKey ? thread.updatedAt : now,
        };
      // Arranging Active is not activity: the thread keeps its `updatedAt`.
      case "thread.active.reorder":
        return { ...thread, activeOrderKey: command.orderKey };
      case "thread.settle": {
        const alreadySettled =
          thread.settledOverride === "settled" &&
          thread.settledAt !== null &&
          thread.pinnedAt === null;
        return {
          ...thread,
          settledOverride: "settled",
          settledAt: alreadySettled ? thread.settledAt : (command.settledAt ?? now),
          unsettledAt: null,
          pinnedAt: null,
          pinOrderKey: null,
          activeOrderKey: null,
          updatedAt: alreadySettled ? thread.updatedAt : now,
        };
      }
      case "thread.unsettle": {
        const alreadyActive = thread.settledOverride === "active";
        return {
          ...thread,
          settledOverride: "active",
          settledAt: null,
          unsettledAt: alreadyActive ? thread.unsettledAt : now,
          updatedAt: alreadyActive ? thread.updatedAt : now,
        };
      }
      case "thread.snooze": {
        const sameWakeTime =
          thread.snoozedUntil !== null &&
          Date.parse(thread.snoozedUntil) === Date.parse(command.snoozedUntil);
        const keptSnoozedAt = sameWakeTime ? thread.snoozedAt : null;
        return {
          ...thread,
          snoozedUntil: command.snoozedUntil,
          snoozedAt: keptSnoozedAt ?? now,
          updatedAt: keptSnoozedAt === null ? now : thread.updatedAt,
        };
      }
      case "thread.unsnooze": {
        const alreadyAwake = thread.snoozedUntil === null;
        return {
          ...thread,
          snoozedUntil: null,
          snoozedAt: null,
          lastSnoozeWakeAt: alreadyAwake ? thread.lastSnoozeWakeAt : now,
          updatedAt: alreadyAwake ? thread.updatedAt : now,
        };
      }
      case "thread.auto-settle.set": {
        const unchanged = command.enabled === (thread.autoSettleDisabledAt === null);
        return {
          ...thread,
          autoSettleDisabledAt: command.enabled ? null : (thread.autoSettleDisabledAt ?? now),
          updatedAt: unchanged ? thread.updatedAt : now,
        };
      }
    }
  })();
  const eventType = (() => {
    switch (command.type) {
      case "thread.model-selection.set":
        return "thread.model-selection-updated" as const;
      case "thread.archive":
        return "thread.archived" as const;
      case "thread.unarchive":
        return "thread.unarchived" as const;
      case "thread.metadata.update":
      case "thread.title.regeneration.complete":
        return "thread.metadata-updated" as const;
      case "thread.mark-unread":
        return "thread.marked-unread" as const;
      case "thread.pin":
        return "thread.pinned" as const;
      case "thread.unpin":
        return "thread.unpinned" as const;
      case "thread.pin.reorder":
        return "thread.pin-reordered" as const;
      case "thread.active.reorder":
        return "thread.active-reordered" as const;
      case "thread.settle":
        return "thread.settled" as const;
      case "thread.unsettle":
        return "thread.unsettled" as const;
      case "thread.snooze":
        return "thread.snoozed" as const;
      case "thread.unsnooze":
        return "thread.unsnoozed" as const;
      case "thread.auto-settle.set":
        return "thread.auto-settle-set" as const;
    }
  })();
  const events: Array<NewDomainEvent> = [
    { type: eventType, threadId: thread.id, occurredAt: now, payload: updated },
  ];
  const effects: Array<PendingEffect> = [];

  if (command.type === "thread.metadata.update" && command.regenerateTitle === true) {
    effects.push(threadTitleGenerationEffect(command.commandId, { type: "regenerate" }));
  }
  if (command.type === "thread.archive") {
    const queued = projection.runs.filter((run) => QUEUED_RUN_STATUSES.has(run.status));
    const queuedIds = new Set(queued.map((run) => run.id));
    for (const run of queued) {
      events.push({
        type: "run.updated",
        threadId: thread.id,
        runId: run.id,
        occurredAt: now,
        payload: { ...run, status: "cancelled", completedAt: now },
      });
    }
    for (const attempt of projection.attempts) {
      if (!queuedIds.has(attempt.runId)) continue;
      if (attempt.status !== "pending" && attempt.status !== "running") continue;
      events.push({
        type: "run-attempt.updated",
        threadId: thread.id,
        runId: attempt.runId,
        occurredAt: now,
        payload: { ...attempt, status: "cancelled", completedAt: now },
      });
    }
    for (const node of projection.nodes) {
      if (node.runId === null || !queuedIds.has(node.runId)) continue;
      if (node.status !== "pending" && node.status !== "running" && node.status !== "waiting") {
        continue;
      }
      events.push({
        type: "node.updated",
        threadId: thread.id,
        runId: node.runId,
        occurredAt: now,
        payload: { ...node, status: "cancelled", completedAt: now },
      });
    }
  }
  // Archive and settle both mean "done with this thread": no live provider
  // session keeps running for it (T3 Code's detach after either). The settle
  // guard already refused a working thread, so this only stops idle sessions.
  if (command.type === "thread.archive" || command.type === "thread.settle") {
    const detached = detachProviderSessions({
      projection,
      commandId: command.commandId,
      reason: command.type === "thread.archive" ? "Thread archived." : "Thread settled.",
      now,
    });
    events.push(...detached.events);
    effects.push(...detached.effects);
  }
  return Result.succeed({ events, effects });
}

/** The run with the highest ordinal, which the sidebar shows (T3 Code's `projection.runs.at(-1)`). */
export const latestRunOf = (
  runs: ReadonlyArray<OrchestrationV2Run>,
): OrchestrationV2Run | undefined =>
  runs.reduce<OrchestrationV2Run | undefined>(
    (found, run) => (found === undefined || run.ordinal > found.ordinal ? run : found),
    undefined,
  );

/**
 * The thread was viewed (T3 Code's `dispatchThreadVisit`): its read marker
 * moves to the visit, never back, so a late visit from another window does
 * not mark a newer completion read twice over. Viewing is not activity:
 * `updatedAt` stays, and the event is written even when nothing moves.
 */
function dispatchThreadVisit(
  command: Extract<OrchestrationV2Command, { type: "thread.visit" }>,
  projection: OrchestrationV2ThreadProjection,
  now: string,
): ThreadCommandDecision {
  const { thread } = projection;
  const movesForward =
    thread.lastVisitedAt === null ||
    DateTime.toEpochMillis(DateTime.makeUnsafe(command.visitedAt)) >
      DateTime.toEpochMillis(DateTime.makeUnsafe(thread.lastVisitedAt));
  return {
    events: [
      {
        type: "thread.visited",
        threadId: thread.id,
        occurredAt: now,
        payload: movesForward ? { ...thread, lastVisitedAt: command.visitedAt } : thread,
      },
    ],
    effects: [],
  };
}

/**
 * The person answered a question (T3 Code's `dispatchRuntimeRequestRespond`,
 * live answers only): the request is resolved with the answers, its node
 * and item complete, and the provider is given the answers.
 */
function dispatchRuntimeRequestRespond(
  command: Extract<OrchestrationV2Command, { type: "runtime-request.respond" }>,
  projection: OrchestrationV2ThreadProjection,
  request: OrchestrationV2RuntimeRequest,
  item: Extract<OrchestrationV2TurnItem, { type: "user_input_request" }>,
  providerSessionId: ProviderSessionId,
  runId: RunId,
  ids: ThreadCommandIds,
  now: string,
): ThreadCommandDecision {
  const base = { threadId: command.threadId, runId, occurredAt: now };
  const node = projection.nodes.find((candidate) => candidate.id === request.nodeId);
  return {
    events: [
      {
        ...base,
        type: "runtime-request.updated",
        payload: { ...request, status: "resolved", resolvedAt: now, answers: command.answers },
      },
      ...(node === undefined
        ? []
        : [
            {
              ...base,
              type: "node.updated",
              payload: { ...node, status: "completed", completedAt: now },
            } as const,
          ]),
      {
        ...base,
        type: "turn-item.updated",
        payload: {
          ...item,
          answers: command.answers,
          status: "completed",
          completedAt: now,
          updatedAt: now,
        },
      },
    ],
    effects: [
      {
        id: ids.effectId,
        request: {
          type: "runtime-request.respond",
          runId,
          providerSessionId,
          requestId: request.id,
          answers: command.answers,
        },
      },
    ],
  };
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
  const threadId = projection.thread.id;
  const runId = ids.runId;
  const ordinal = projection.runs.reduce((highest, run) => Math.max(highest, run.ordinal), 0) + 1;
  const events: Array<NewDomainEvent> = [];

  // Sending a message brings the thread back to active work and clears the
  // person's override (T3 Code's `dispatchMessage`), so automatic settlement
  // follows its usual rules again; it wakes a snoozed thread too, without
  // stamping `lastSnoozeWakeAt`, as T3 Code's does.
  let thread = projection.thread;
  if (thread.settledOverride !== null) {
    thread = {
      ...thread,
      settledOverride: null,
      settledAt: null,
      unsettledAt: thread.settledOverride === "active" ? thread.unsettledAt : now,
      updatedAt: now,
    };
    events.push({ type: "thread.unsettled", threadId, occurredAt: now, payload: thread });
  }
  if (thread.snoozedUntil !== null) {
    thread = { ...thread, snoozedUntil: null, snoozedAt: null, updatedAt: now };
    events.push({ type: "thread.unsnoozed", threadId, occurredAt: now, payload: thread });
  }

  // The first message titles the thread with its seed at once, and asks a
  // provider for a better title beside the turn (T3 Code's first-title trigger).
  const firstTitle = command.titleSeed !== undefined && projection.messages.length === 0;
  const titled = firstTitle ? command.titleSeed : thread.title;

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

  if (firstTitle || titled !== thread.title || existingProviderThread === undefined) {
    events.push({
      type: "thread.metadata-updated",
      threadId,
      occurredAt: now,
      payload: {
        ...thread,
        title: titled,
        activeProviderThreadId: providerThread.id,
        ...(firstTitle
          ? { titleRegeneration: { requestId: command.commandId, startedAt: now } }
          : {}),
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
    effects: [
      ...(firstTitle
        ? [
            threadTitleGenerationEffect(command.commandId, {
              type: "initial",
              messageId: command.messageId,
            }),
          ]
        : []),
      { id: ids.effectId, request: { type: "provider-turn.start", runId } },
    ],
  };
}

import type { CommandId, MessageId } from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2AppThread,
  type OrchestrationV2Run,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadProjection,
  QUEUED_RUN_STATUSES,
} from "@playstead/contracts/orchestrationV2";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

import type { PendingEffect } from "./EffectOutbox.ts";
import type { NewDomainEvent } from "./EventSink.ts";
import { detachProviderSessions } from "./ProviderSessionDetach.ts";
import {
  reject,
  requireThread,
  type ThreadCommandInput,
  type ThreadCommandResult,
} from "./ThreadCommandDecision.ts";
import { isAutoSettlementCandidate, snoozeStateOf } from "./ThreadSettlementPolicy.ts";
import { cancelRuns } from "./RunCancellation.ts";
import { planThreadDeletion } from "./ThreadDeletion.ts";

/**
 * The commands that change the thread itself, decided by `decideThreadMutation`
 * (T3 Code's `dispatchThreadMutation` list, without pull requests and the
 * provider switch).
 */
export type ThreadMutationCommand = Extract<
  OrchestrationV2ServerCommand,
  {
    readonly type:
      | "thread.model-selection.set"
      | "thread.runtime-mode.set"
      | "thread.interaction-mode.set"
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
export const threadTitleGenerationEffect = (
  commandId: CommandId,
  kind:
    | { readonly type: "initial"; readonly messageId: MessageId }
    | { readonly type: "regenerate" },
): PendingEffect => ({
  id: `effect:${commandId}:thread-title.generate`,
  request: { type: "thread-title.generate", kind },
});

/**
 * The run with the highest ordinal that has left the queue, which the
 * sidebar shows (T3 Code's latest run): a queued run waits behind it and
 * does not count.
 */
export const latestRunOf = (
  runs: ReadonlyArray<OrchestrationV2Run>,
): OrchestrationV2Run | undefined =>
  runs.reduce<OrchestrationV2Run | undefined>(
    (found, run) =>
      run.status !== "queued" && (found === undefined || run.ordinal > found.ordinal) ? run : found,
    undefined,
  );

/** The commands an archived thread refuses (T3 Code's list). */
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
 * neither a pending approval or question nor a message in the queue. T3
 * Code lets a queued automatic message through (a notification or a
 * delegated completion); Playstead sends none, so every queued run blocks.
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
 * a provider waiting on the person (an approval or a question), a run still
 * working, or a message waiting in the queue. T3 Code lets a question
 * answerable by a later message through, and cancels it; every question
 * Playstead's providers ask is answered live, so each one blocks, as every
 * approval does. T3 Code also lets queued automatic messages through;
 * Playstead sends none.
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
 * The one decider for every command that changes the thread itself (T3
 * Code's `dispatchThreadMutation` in
 * `apps/server/src/orchestration-v2/Orchestrator.ts` at 2577baf): it checks
 * the command's rules, writes the whole updated thread in the command's own
 * event, and then does what the change brings with it.
 *
 * - `thread.model-selection.set` changes the model the next run copies;
 *   naming another instance is T3 Code's provider switch, which Playstead
 *   refuses. `thread.runtime-mode.set` and `thread.interaction-mode.set`
 *   change the modes the thread's next turn starts in; as in T3 Code an
 *   active run prevents none of the three.
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
export const decideThreadMutation = (
  input: ThreadCommandInput<ThreadMutationCommand>,
): ThreadCommandResult =>
  Result.gen(function* () {
    const { command, state, now } = input;
    const projection = yield* requireThread(command, state);
    const { thread } = projection;
    if (command.type === "thread.archive" && thread.archivedAt !== null) {
      return yield* reject(command, `Thread ${thread.id} is already archived.`);
    }
    if (command.type === "thread.unarchive" && thread.archivedAt === null) {
      return yield* reject(command, `Thread ${thread.id} is not archived.`);
    }
    if (REFUSED_WHILE_ARCHIVED.has(command.type) && thread.archivedAt !== null) {
      return yield* reject(command, `Thread ${thread.id} is archived.`);
    }
    // Only a pinned thread has a place among the pins: refusing, rather than
    // pinning, keeps a reorder that raced an unpin from bringing the pin back.
    if (command.type === "thread.pin.reorder" && thread.pinnedAt === null) {
      return yield* reject(command, `Thread ${thread.id} is not pinned and cannot be reordered.`);
    }
    if (
      command.type === "thread.active.reorder" &&
      (thread.pinnedAt !== null || thread.settledOverride === "settled")
    ) {
      return yield* reject(command, `Thread ${thread.id} is not active and cannot be reordered.`);
    }
    if (
      command.type === "thread.model-selection.set" &&
      command.modelSelection.instanceId !== thread.providerInstanceId
    ) {
      return yield* reject(
        command,
        `Thread ${thread.id} runs on ${thread.providerInstanceId}. Choose one of its models; switching provider is not available yet.`,
      );
    }
    let markUnreadVisitedAt: string | null = null;
    if (command.type === "thread.mark-unread") {
      const latestRunCompletedAt = latestRunOf(projection.runs)?.completedAt ?? null;
      if (latestRunCompletedAt === null) {
        return yield* reject(command, `Thread ${thread.id} has no completed run to mark unread.`);
      }
      markUnreadVisitedAt = DateTime.formatIso(
        DateTime.subtract(DateTime.makeUnsafe(latestRunCompletedAt), { milliseconds: 1 }),
      );
    }
    if (command.type === "thread.settle") {
      const blocker = settleBlocker(projection);
      if (blocker !== null) return yield* reject(command, `Thread ${thread.id} ${blocker}`);
    }
    if (command.type === "thread.snooze") {
      const blocker = snoozeBlocker(projection, command.snoozedUntil, now);
      if (blocker !== null) return yield* reject(command, `Thread ${thread.id} ${blocker}`);
    }

    const events: Array<NewDomainEvent> = [
      {
        type: mutationEventType(command),
        threadId: thread.id,
        occurredAt: now,
        payload: mutatedThread(command, thread, markUnreadVisitedAt, now),
      },
    ];
    const effects: Array<PendingEffect> = [];

    if (command.type === "thread.metadata.update" && command.regenerateTitle === true) {
      effects.push(threadTitleGenerationEffect(command.commandId, { type: "regenerate" }));
    }
    if (command.type === "thread.archive")
      events.push(
        ...cancelRuns(
          projection,
          projection.runs.filter((run) => QUEUED_RUN_STATUSES.has(run.status)),
          now,
        ),
      );
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
    return { events, effects };
  });

function mutatedThread(
  command: ThreadMutationCommand,
  thread: OrchestrationV2AppThread,
  markUnreadVisitedAt: string | null,
  now: string,
): OrchestrationV2AppThread {
  switch (command.type) {
    case "thread.model-selection.set":
      return { ...thread, modelSelection: command.modelSelection, updatedAt: now };
    case "thread.runtime-mode.set":
      return { ...thread, runtimeMode: command.runtimeMode, updatedAt: now };
    case "thread.interaction-mode.set":
      return { ...thread, interactionMode: command.interactionMode, updatedAt: now };
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
}

function mutationEventType(command: ThreadMutationCommand) {
  switch (command.type) {
    case "thread.model-selection.set":
      return "thread.model-selection-updated" as const;
    case "thread.runtime-mode.set":
      return "thread.runtime-mode-updated" as const;
    case "thread.interaction-mode.set":
      return "thread.interaction-mode-updated" as const;
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
}

/**
 * The settlement sweep's settle (T3 Code's `thread.auto-settle` case in
 * `dispatchCommand`): the sweep decided on what it read, so any change
 * since, or any override the person set (an un-settle's "active" too), wins
 * over it. Otherwise it is `thread.settle`, guard included.
 */
export const decideThreadAutoSettle = (
  input: ThreadCommandInput<Extract<OrchestrationV2ServerCommand, { type: "thread.auto-settle" }>>,
): ThreadCommandResult =>
  Result.gen(function* () {
    const { command, state, now } = input;
    const projection = yield* requireThread(command, state);
    const { thread } = projection;
    if (thread.settledOverride !== null || thread.updatedAt !== command.snapshotAt) {
      return yield* reject(command, `Thread ${thread.id} changed before automatic settlement.`);
    }
    const latest = latestRunOf(projection.runs);
    const latestUserMessageAt = projection.messages
      .filter((message) => message.role === "user")
      .reduce<string | null>(
        (latest, message) =>
          latest === null || message.createdAt > latest ? message.createdAt : latest,
        null,
      );
    const eligible = isAutoSettlementCandidate(
      {
        ...thread,
        thread,
        status: latest?.status ?? "idle",
        latestRunId: latest?.id ?? null,
        latestRunRequestedAt: latest?.requestedAt ?? null,
        latestRunStartedAt: latest?.startedAt ?? null,
        latestRunCompletedAt: latest?.completedAt ?? null,
        latestUserMessageAt,
        hasPendingRuntimeRequest: projection.runtimeRequests.some(
          (request) => request.status === "pending",
        ),
        hasActiveRun: projection.runs.some(
          (run) => ACTIVE_RUN_STATUSES.has(run.status) || QUEUED_RUN_STATUSES.has(run.status),
        ),
      },
      snoozeStateOf(thread),
      DateTime.toEpochMillis(DateTime.makeUnsafe(now)),
    );
    if (!eligible)
      return yield* reject(
        command,
        `Thread ${thread.id} is not eligible for automatic settlement.`,
      );
    return yield* decideThreadMutation({
      ...input,
      command: {
        type: "thread.settle",
        commandId: command.commandId,
        threadId: command.threadId,
        ...(command.settledAt === undefined ? {} : { settledAt: command.settledAt }),
      },
    });
  });

/**
 * The thread was viewed (T3 Code's `dispatchThreadVisit`): its read marker
 * moves to the visit, never back, so a late visit from another window does
 * not mark a newer completion read twice over. Viewing is not activity:
 * `updatedAt` stays, and the event is written even when nothing moves.
 */
export const decideThreadVisit = (
  input: ThreadCommandInput<Extract<OrchestrationV2ServerCommand, { type: "thread.visit" }>>,
): ThreadCommandResult =>
  Result.gen(function* () {
    const { command, state, now } = input;
    const { thread } = yield* requireThread(command, state);
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
  });

/** `thread.delete` deletes the thread (`ThreadDeletion.ts`). */
export const decideThreadDelete = (
  input: ThreadCommandInput<Extract<OrchestrationV2ServerCommand, { type: "thread.delete" }>>,
): ThreadCommandResult =>
  Result.gen(function* () {
    const { command, state, now } = input;
    const projection = yield* requireThread(command, state);
    return planThreadDeletion({ command, projection, now });
  });

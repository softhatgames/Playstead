import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NodeId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnItemId,
} from "./baseSchemas.ts";
import { OrchestrationProjectShell } from "./orchestrationProject.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

/**
 * Orchestration v2's contract, trimmed from T3 Code's
 * `packages/contracts/src/orchestrationV2.ts` at 2577baf to what a thread
 * needs to chat: the thread, its runs and the provider work under them, the
 * commands that create a thread and send it a message, the events they
 * produce, and the thread and shell streams. Times are ISO strings, as the
 * project contract keeps them, so one schema serves the database and the wire.
 *
 * Runtime requests are only the provider's questions to the person; there
 * are no approvals, since every thread runs in Full access. Absent:
 * subagents, plans, checkpoints and context handoffs.
 */

export const ORCHESTRATION_V2_WS_METHODS = {
  searchThreads: "orchestration.searchThreads",
  dispatchCommand: "orchestration.dispatchCommand",
  getArchivedShellSnapshot: "orchestration.getArchivedShellSnapshot",
  subscribeArchivedShell: "orchestration.subscribeArchivedShell",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
} as const;

/** The provider instance and model a thread runs (T3 Code's `ModelSelection`, including provider options). */
export const ModelSelection = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: TrimmedNonEmptyString,
        value: Schema.Union([Schema.String, Schema.Boolean]),
      }),
    ),
  ),
});
export type ModelSelection = typeof ModelSelection.Type;

/** Every thread runs in Full access; T3 Code's other modes are absent. */
export const RuntimeMode = Schema.Literal("full-access");
export type RuntimeMode = typeof RuntimeMode.Type;

/** Every thread uses the default interaction mode; plan mode is absent. */
export const ProviderInteractionMode = Schema.Literal("default");
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;

/** A provider-side id, such as Claude's session id (T3 Code's `OrchestrationV2ProviderRef`). */
const OrchestrationV2ProviderRef = Schema.Struct({
  driver: ProviderDriverKind,
  nativeId: TrimmedNonEmptyString,
});
export type OrchestrationV2ProviderRef = typeof OrchestrationV2ProviderRef.Type;

/**
 * A thread field added after threads were first stored: a row written before
 * it decodes with null (T3 Code's decoding defaults on the thread).
 */
const NullOrTimeDefaultNull = Schema.NullOr(IsoDateTime).pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
);

const NullOrOrderKeyDefaultNull = Schema.NullOr(TrimmedNonEmptyString).pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
);

/** The person settled the thread, or brought it back to active work (T3 Code's). */
const ThreadSettledOverride = Schema.NullOr(Schema.Literals(["settled", "active"]));
export type ThreadSettledOverride = typeof ThreadSettledOverride.Type;

/**
 * A thread (T3 Code's `OrchestrationV2AppThread`, trimmed). An archived
 * thread has `archivedAt`; a deleted one keeps its row with `deletedAt`,
 * T3 Code's soft delete, and refuses every command. `lastVisitedAt` is the
 * read marker: the thread is unread while its latest run completed after it.
 *
 * A settled thread has `settledOverride` "settled" and `settledAt`; one the
 * person un-settled has "active" and `unsettledAt`, which keeps automatic
 * settlement away until a message clears the override. A pinned thread has
 * `pinnedAt`. `pinOrderKey` and `activeOrderKey` are the pinned and active
 * lists' a–z order keys, which settling clears.
 */
const ThreadTitleRegeneration = Schema.Struct({
  requestId: CommandId,
  startedAt: IsoDateTime,
});

export const OrchestrationV2AppThread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  providerInstanceId: ProviderInstanceId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  activeProviderThreadId: Schema.NullOr(ProviderThreadId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: NullOrTimeDefaultNull,
  deletedAt: NullOrTimeDefaultNull,
  lastVisitedAt: NullOrTimeDefaultNull,
  worktreePath: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  titleRegeneration: Schema.optionalKey(Schema.NullOr(ThreadTitleRegeneration)),
  autoSettleDisabledAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  settledOverride: ThreadSettledOverride.pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  settledAt: NullOrTimeDefaultNull,
  unsettledAt: NullOrTimeDefaultNull,
  snoozedUntil: NullOrTimeDefaultNull,
  snoozedAt: NullOrTimeDefaultNull,
  lastSnoozeWakeAt: NullOrTimeDefaultNull,
  pinnedAt: NullOrTimeDefaultNull,
  pinOrderKey: NullOrOrderKeyDefaultNull,
  activeOrderKey: NullOrOrderKeyDefaultNull,
});
export type OrchestrationV2AppThread = typeof OrchestrationV2AppThread.Type;

/** T3 Code's run statuses without the queue, preparation and rollback ones. */
export const OrchestrationV2RunStatus = Schema.Literals([
  "starting",
  "running",
  "waiting",
  "completed",
  "interrupted",
  "failed",
  "cancelled",
]);
export type OrchestrationV2RunStatus = typeof OrchestrationV2RunStatus.Type;

/** The statuses in which a run is active, as T3 Code's `resolveMessageDispatchIntent` counts them. */
export const ACTIVE_RUN_STATUSES: ReadonlySet<OrchestrationV2RunStatus> = new Set([
  "starting",
  "running",
  "waiting",
]);

/**
 * The statuses of a run waiting in the queue behind an active one. Playstead
 * has no queue until permission modes and turn control (slice 1) bring it,
 * so the set is empty; archive and delete cancel what is in it, as they do
 * T3 Code's `queued` runs.
 */
export const QUEUED_RUN_STATUSES: ReadonlySet<OrchestrationV2RunStatus> = new Set();

export const OrchestrationV2Run = Schema.Struct({
  id: RunId,
  threadId: ThreadId,
  ordinal: PositiveInt,
  providerInstanceId: ProviderInstanceId,
  modelSelection: ModelSelection,
  providerThreadId: Schema.NullOr(ProviderThreadId),
  userMessageId: MessageId,
  rootNodeId: Schema.NullOr(NodeId),
  activeAttemptId: Schema.NullOr(RunAttemptId),
  status: OrchestrationV2RunStatus,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationV2Run = typeof OrchestrationV2Run.Type;

const TerminalWorkStatuses = ["completed", "interrupted", "failed", "cancelled"] as const;

export const OrchestrationV2RunAttempt = Schema.Struct({
  id: RunAttemptId,
  runId: RunId,
  attemptOrdinal: PositiveInt,
  rootNodeId: NodeId,
  providerInstanceId: ProviderInstanceId,
  providerThreadId: ProviderThreadId,
  providerTurnId: Schema.NullOr(ProviderTurnId),
  reason: Schema.Literal("initial"),
  status: Schema.Literals(["pending", "running", ...TerminalWorkStatuses]),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationV2RunAttempt = typeof OrchestrationV2RunAttempt.Type;

export const OrchestrationV2ExecutionNode = Schema.Struct({
  id: NodeId,
  threadId: ThreadId,
  runId: Schema.NullOr(RunId),
  parentNodeId: Schema.NullOr(NodeId),
  rootNodeId: NodeId,
  kind: Schema.Literals(["root_turn", "assistant_message", "tool_call", "user_input_request"]),
  status: Schema.Literals(["pending", "running", "waiting", ...TerminalWorkStatuses]),
  providerThreadId: Schema.NullOr(ProviderThreadId),
  providerTurnId: Schema.NullOr(ProviderTurnId),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationV2ExecutionNode = typeof OrchestrationV2ExecutionNode.Type;

export const OrchestrationV2ProviderSession = Schema.Struct({
  id: ProviderSessionId,
  driver: ProviderDriverKind,
  providerInstanceId: ProviderInstanceId,
  status: Schema.Literals(["starting", "ready", "running", "stopped", "error"]),
  cwd: TrimmedNonEmptyString,
  model: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastError: Schema.NullOr(Schema.String),
});
export type OrchestrationV2ProviderSession = typeof OrchestrationV2ProviderSession.Type;

export const OrchestrationV2ProviderThread = Schema.Struct({
  id: ProviderThreadId,
  driver: ProviderDriverKind,
  providerInstanceId: ProviderInstanceId,
  providerSessionId: Schema.NullOr(ProviderSessionId),
  appThreadId: ThreadId,
  /** Claude's session id or Codex's thread id, once a session has run the thread. */
  nativeThreadRef: Schema.NullOr(OrchestrationV2ProviderRef),
  status: Schema.Literals(["not_loaded", "idle", "active", "closed", "error"]),
  firstRunOrdinal: Schema.NullOr(PositiveInt),
  lastRunOrdinal: Schema.NullOr(PositiveInt),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationV2ProviderThread = typeof OrchestrationV2ProviderThread.Type;

export const OrchestrationV2ProviderTurn = Schema.Struct({
  id: ProviderTurnId,
  providerThreadId: ProviderThreadId,
  nodeId: NodeId,
  runAttemptId: Schema.NullOr(RunAttemptId),
  ordinal: PositiveInt,
  status: Schema.Literals(["pending", "running", ...TerminalWorkStatuses]),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationV2ProviderTurn = typeof OrchestrationV2ProviderTurn.Type;

export const OrchestrationV2ConversationMessage = Schema.Struct({
  id: MessageId,
  threadId: ThreadId,
  runId: Schema.NullOr(RunId),
  nodeId: Schema.NullOr(NodeId),
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationV2ConversationMessage = typeof OrchestrationV2ConversationMessage.Type;

const OrchestrationV2TurnItemStatus = Schema.Literals([
  "pending",
  "running",
  "waiting",
  ...TerminalWorkStatuses,
]);
export type OrchestrationV2TurnItemStatus = typeof OrchestrationV2TurnItemStatus.Type;

/** Producers must redact credentials before building one (T3 Code's rule). */
export const OrchestrationV2ProviderFailure = Schema.Struct({
  class: Schema.Literals(["provider_error", "transport_error", "unknown"]),
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
});
export type OrchestrationV2ProviderFailure = typeof OrchestrationV2ProviderFailure.Type;

/** One question a provider asks (T3 Code's `OrchestrationV2UserInputQuestion`, trimmed). */
export const OrchestrationV2UserInputQuestion = Schema.Struct({
  /** What the answer is keyed by: Codex's question id, or Claude's question text. */
  id: TrimmedNonEmptyString,
  header: TrimmedNonEmptyString,
  question: TrimmedNonEmptyString,
  options: Schema.Array(
    Schema.Struct({ label: TrimmedNonEmptyString, description: Schema.String }),
  ),
  multiSelect: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationV2UserInputQuestion = typeof OrchestrationV2UserInputQuestion.Type;

/**
 * The person's answers by question id: an option's label, several labels
 * for a multiple choice, or their own words (T3 Code's
 * `ProviderUserInputAnswers`, typed as its interface builds them).
 */
export const ProviderUserInputAnswers = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Array(Schema.String)]),
);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

/**
 * Something a provider waits on the person for (T3 Code's
 * `OrchestrationV2RuntimeRequest`, trimmed to questions). It is pending until
 * answered (`resolved`). A turn that ends first cancels it, and a server
 * that stops while it is pending leaves it `expired`, no longer answerable.
 */
export const OrchestrationV2RuntimeRequest = Schema.Struct({
  id: RuntimeRequestId,
  nodeId: NodeId,
  providerTurnId: Schema.NullOr(ProviderTurnId),
  kind: Schema.Literal("user_input"),
  status: Schema.Literals(["pending", "resolved", "expired", "cancelled"]),
  responseCapability: Schema.Union([
    Schema.Struct({ type: Schema.Literal("live"), providerSessionId: ProviderSessionId }),
    Schema.Struct({ type: Schema.Literal("not_resumable"), reason: Schema.String }),
  ]),
  createdAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
  answers: Schema.optionalKey(ProviderUserInputAnswers),
});
export type OrchestrationV2RuntimeRequest = typeof OrchestrationV2RuntimeRequest.Type;

const TurnItemBaseFields = {
  id: TurnItemId,
  threadId: ThreadId,
  runId: Schema.NullOr(RunId),
  nodeId: Schema.NullOr(NodeId),
  providerThreadId: Schema.NullOr(ProviderThreadId),
  providerTurnId: Schema.NullOr(ProviderTurnId),
  /** The item's position in the thread, given by the event sink when it is first written. */
  ordinal: NonNegativeInt,
  status: OrchestrationV2TurnItemStatus,
  title: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
} as const;

/**
 * What the thread view shows, item by item: T3 Code's turn items trimmed to
 * messages, file changes, commands, other tools, errors and a run's
 * interrupt, and the provider's questions. A `file_change` carries the
 * written content in `newStr`, which T3 Code's Claude adapter leaves out. An
 * interrupt is a request, written when the person asks, and a result,
 * written when the run has stopped; the result names its request in
 * `parentItemId`. A `user_input_request` shows a runtime request's
 * questions, and their answers once given (T3 Code's `questionAnswer`,
 * trimmed).
 */
export const OrchestrationV2TurnItem = Schema.Union([
  Schema.Struct({
    ...TurnItemBaseFields,
    type: Schema.Literal("user_message"),
    messageId: MessageId,
    text: Schema.String,
  }),
  Schema.Struct({
    ...TurnItemBaseFields,
    type: Schema.Literal("assistant_message"),
    messageId: MessageId,
    text: Schema.String,
    streaming: Schema.Boolean,
  }),
  Schema.Struct({
    ...TurnItemBaseFields,
    type: Schema.Literal("file_change"),
    fileName: TrimmedNonEmptyString,
    newStr: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    ...TurnItemBaseFields,
    type: Schema.Literal("command_execution"),
    input: Schema.String,
    output: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    ...TurnItemBaseFields,
    type: Schema.Literal("dynamic_tool"),
    toolName: TrimmedNonEmptyString,
    input: Schema.Unknown,
    output: Schema.optionalKey(Schema.Unknown),
  }),
  Schema.Struct({
    ...TurnItemBaseFields,
    type: Schema.Literal("error"),
    failure: OrchestrationV2ProviderFailure,
  }),
  Schema.Struct({
    ...TurnItemBaseFields,
    type: Schema.Literal("user_input_request"),
    requestId: RuntimeRequestId,
    questions: Schema.Array(OrchestrationV2UserInputQuestion),
    answers: Schema.optionalKey(ProviderUserInputAnswers),
  }),
  Schema.Struct({
    ...TurnItemBaseFields,
    type: Schema.Literal("run_interrupt_request"),
    message: Schema.String,
  }),
  Schema.Struct({
    ...TurnItemBaseFields,
    type: Schema.Literal("run_interrupt_result"),
    message: Schema.String,
    parentItemId: TurnItemId,
  }),
]);
export type OrchestrationV2TurnItem = typeof OrchestrationV2TurnItem.Type;

const EventBaseFields = {
  id: EventId,
  threadId: ThreadId,
  runId: Schema.optionalKey(RunId),
  occurredAt: IsoDateTime,
} as const;

const event = <Type extends string, Payload extends Schema.Top>(type: Type, payload: Payload) =>
  Schema.Struct({ ...EventBaseFields, type: Schema.Literal(type), payload });

export const OrchestrationV2DomainEvent = Schema.Union([
  event("thread.created", OrchestrationV2AppThread),
  event("thread.metadata-updated", OrchestrationV2AppThread),
  event("thread.model-selection-updated", OrchestrationV2AppThread),
  event("thread.archived", OrchestrationV2AppThread),
  event("thread.unarchived", OrchestrationV2AppThread),
  event("thread.deleted", OrchestrationV2AppThread),
  event("thread.visited", OrchestrationV2AppThread),
  event("thread.marked-unread", OrchestrationV2AppThread),
  event("thread.pinned", OrchestrationV2AppThread),
  event("thread.pin-reordered", OrchestrationV2AppThread),
  event("thread.active-reordered", OrchestrationV2AppThread),
  event("thread.unpinned", OrchestrationV2AppThread),
  event("thread.auto-settle-set", OrchestrationV2AppThread),
  event("thread.settled", OrchestrationV2AppThread),
  event("thread.unsettled", OrchestrationV2AppThread),
  event("thread.snoozed", OrchestrationV2AppThread),
  event("thread.unsnoozed", OrchestrationV2AppThread),
  event("run.created", OrchestrationV2Run),
  event("run.updated", OrchestrationV2Run),
  event("run-attempt.created", OrchestrationV2RunAttempt),
  event("run-attempt.updated", OrchestrationV2RunAttempt),
  event("node.updated", OrchestrationV2ExecutionNode),
  event("provider-session.updated", OrchestrationV2ProviderSession),
  event("provider-thread.updated", OrchestrationV2ProviderThread),
  event("provider-turn.updated", OrchestrationV2ProviderTurn),
  event("message.updated", OrchestrationV2ConversationMessage),
  event("turn-item.updated", OrchestrationV2TurnItem),
  event("runtime-request.updated", OrchestrationV2RuntimeRequest),
]);
export type OrchestrationV2DomainEvent = typeof OrchestrationV2DomainEvent.Type;

/** A thread event as the log keeps it, beside project events in one sequence. */
export const OrchestrationV2StoredEvent = Schema.Struct({
  sequence: NonNegativeInt,
  aggregateKind: Schema.Literal("thread"),
  commandId: Schema.NullOr(CommandId),
  event: OrchestrationV2DomainEvent,
});
export type OrchestrationV2StoredEvent = typeof OrchestrationV2StoredEvent.Type;

/** Everything the thread view reads, rebuilt from the projection tables. */
export const OrchestrationV2ThreadProjection = Schema.Struct({
  thread: OrchestrationV2AppThread,
  runs: Schema.Array(OrchestrationV2Run),
  attempts: Schema.Array(OrchestrationV2RunAttempt),
  nodes: Schema.Array(OrchestrationV2ExecutionNode),
  providerSessions: Schema.Array(OrchestrationV2ProviderSession),
  providerThreads: Schema.Array(OrchestrationV2ProviderThread),
  providerTurns: Schema.Array(OrchestrationV2ProviderTurn),
  messages: Schema.Array(OrchestrationV2ConversationMessage),
  /** In ordinal order. */
  turnItems: Schema.Array(OrchestrationV2TurnItem),
  runtimeRequests: Schema.Array(OrchestrationV2RuntimeRequest),
  updatedAt: IsoDateTime,
});
export type OrchestrationV2ThreadProjection = typeof OrchestrationV2ThreadProjection.Type;

const OrchestrationV2ShellThreadStatus = Schema.Union([
  Schema.Literal("idle"),
  OrchestrationV2RunStatus,
]);
export type OrchestrationV2ShellThreadStatus = typeof OrchestrationV2ShellThreadStatus.Type;

/** A thread as the sidebar lists it (T3 Code's `OrchestrationV2ThreadShell`, trimmed). */
export const OrchestrationV2ThreadShell = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  providerInstanceId: ProviderInstanceId,
  modelSelection: ModelSelection,
  latestRunId: Schema.NullOr(RunId),
  activeRunId: Schema.NullOr(RunId),
  /** The latest run's status, or `idle` before the first message. */
  status: OrchestrationV2ShellThreadStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
  deletedAt: Schema.NullOr(IsoDateTime),
  /** When the latest run was asked for, or null before the first message. */
  latestRunRequestedAt: Schema.NullOr(IsoDateTime),
  /** When the latest run completed, or null while it has not (T3 Code's `latestRunCompletedAt`). */
  latestRunCompletedAt: Schema.NullOr(IsoDateTime),
  lastVisitedAt: Schema.NullOr(IsoDateTime),
  worktreePath: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  titleRegeneration: Schema.optionalKey(Schema.NullOr(ThreadTitleRegeneration)),
  autoSettleDisabledAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  settledOverride: ThreadSettledOverride,
  settledAt: Schema.NullOr(IsoDateTime),
  unsettledAt: Schema.NullOr(IsoDateTime),
  snoozedUntil: NullOrTimeDefaultNull,
  snoozedAt: NullOrTimeDefaultNull,
  lastSnoozeWakeAt: NullOrTimeDefaultNull,
  pinnedAt: Schema.NullOr(IsoDateTime),
  pinOrderKey: Schema.NullOr(TrimmedNonEmptyString),
  activeOrderKey: Schema.NullOr(TrimmedNonEmptyString),
});
export type OrchestrationV2ThreadShell = typeof OrchestrationV2ThreadShell.Type;

export const OrchestrationV2ShellSnapshot = Schema.Struct({
  /** The last application event the snapshot includes. */
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  /** The threads not archived, oldest first. */
  threads: Schema.Array(OrchestrationV2ThreadShell),
  /**
   * Archived threads, kept apart from the rest. The sidebar's stream sends
   * none here, as T3 Code's active shell does; **Settings → Archive** reads
   * them from the archived shell.
   */
  archivedThreads: Schema.Array(OrchestrationV2ThreadShell),
});
export type OrchestrationV2ShellSnapshot = typeof OrchestrationV2ShellSnapshot.Type;

/**
 * The snapshot first, then each change after it. A thread that is archived
 * or deleted leaves the sidebar with `thread.removed`.
 */
export const OrchestrationV2ShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationV2ShellSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("project.removed"),
    sequence: NonNegativeInt,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("project.updated"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread.updated"),
    sequence: NonNegativeInt,
    thread: OrchestrationV2ThreadShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread.removed"),
    sequence: NonNegativeInt,
    threadId: ThreadId,
  }),
]);
export type OrchestrationV2ShellStreamItem = typeof OrchestrationV2ShellStreamItem.Type;

/** **Settings → Archive**'s threads, with the projects they belong to (T3 Code's). */
export const OrchestrationV2ArchivedShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  /** Oldest first. */
  threads: Schema.Array(OrchestrationV2ThreadShell),
});
export type OrchestrationV2ArchivedShellSnapshot = typeof OrchestrationV2ArchivedShellSnapshot.Type;

/**
 * The archived shell, then each change: a thread archived, or changed while
 * archived, is updated, and one unarchived or deleted is removed.
 */
export const OrchestrationV2ArchivedShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationV2ArchivedShellSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread.updated"),
    sequence: NonNegativeInt,
    thread: OrchestrationV2ThreadShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread.removed"),
    sequence: NonNegativeInt,
    threadId: ThreadId,
  }),
]);
export type OrchestrationV2ArchivedShellStreamItem =
  typeof OrchestrationV2ArchivedShellStreamItem.Type;

export const OrchestrationV2SubscribeThreadInput = Schema.Struct({ threadId: ThreadId });
export type OrchestrationV2SubscribeThreadInput = typeof OrchestrationV2SubscribeThreadInput.Type;

/** The thread's projection first, then each of its events after it. */
export const OrchestrationV2ThreadStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshotSequence: NonNegativeInt,
    projection: OrchestrationV2ThreadProjection,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    sequence: NonNegativeInt,
    event: OrchestrationV2DomainEvent,
  }),
]);
export type OrchestrationV2ThreadStreamItem = typeof OrchestrationV2ThreadStreamItem.Type;

/**
 * The commands a client sends, trimmed from T3 Code's `OrchestrationV2Command`.
 * A thread is created with its project, provider instance and model, always in
 * Full access and the default interaction mode. Its model can change to
 * another of the same provider instance's. A message is plain text; the
 * first one's `titleSeed` titles the thread. `run.interrupt` stops a run
 * that is still active. `runtime-request.respond` answers a provider's
 * question; there are no approval decisions. `thread.archive` and
 * `thread.unarchive` move a thread to and from **Settings → Archive**, and
 * `thread.delete` deletes it. `thread.metadata.update` renames it.
 * `thread.visit` moves its read marker forward when the thread is viewed,
 * and `thread.mark-unread` moves it back before the latest run's completion.
 * `thread.pin` and `thread.unpin` pin and unpin it; `thread.settle` moves it
 * out of active work and `thread.unsettle` brings it back.
 */
export const OrchestrationV2Command = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("thread.create"),
    commandId: CommandId,
    threadId: ThreadId,
    projectId: ProjectId,
    title: TrimmedNonEmptyString,
    modelSelection: ModelSelection,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.model-selection.set"),
    commandId: CommandId,
    threadId: ThreadId,
    modelSelection: ModelSelection,
  }),
  Schema.Struct({
    type: Schema.Literal("message.dispatch"),
    commandId: CommandId,
    threadId: ThreadId,
    messageId: MessageId,
    text: TrimmedNonEmptyString,
    titleSeed: Schema.optionalKey(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    type: Schema.Literal("run.interrupt"),
    commandId: CommandId,
    threadId: ThreadId,
    runId: RunId,
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-request.respond"),
    commandId: CommandId,
    threadId: ThreadId,
    requestId: RuntimeRequestId,
    answers: ProviderUserInputAnswers,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.archive"),
    commandId: CommandId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.unarchive"),
    commandId: CommandId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.delete"),
    commandId: CommandId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.visit"),
    commandId: CommandId,
    threadId: ThreadId,
    visitedAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.mark-unread"),
    commandId: CommandId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.metadata.update"),
    commandId: CommandId,
    threadId: ThreadId,
    title: Schema.optionalKey(TrimmedNonEmptyString),
    regenerateTitle: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.title.regeneration.complete"),
    commandId: CommandId,
    threadId: ThreadId,
    requestId: CommandId,
    title: Schema.optionalKey(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.pin"),
    commandId: CommandId,
    threadId: ThreadId,
    /** The pinned list's order key, kept only by the first pin. */
    orderKey: Schema.optionalKey(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.pin.reorder"),
    commandId: CommandId,
    threadId: ThreadId,
    orderKey: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.active.reorder"),
    commandId: CommandId,
    threadId: ThreadId,
    orderKey: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.unpin"),
    commandId: CommandId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.auto-settle.set"),
    commandId: CommandId,
    threadId: ThreadId,
    enabled: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.auto-settle"),
    commandId: CommandId,
    threadId: ThreadId,
    snapshotAt: IsoDateTime,
    settledAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.settle"),
    commandId: CommandId,
    threadId: ThreadId,
    settledAt: Schema.optionalKey(IsoDateTime),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.snooze"),
    commandId: CommandId,
    threadId: ThreadId,
    snoozedUntil: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.unsnooze"),
    commandId: CommandId,
    threadId: ThreadId,
    reason: Schema.Literal("user"),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.unsettle"),
    commandId: CommandId,
    threadId: ThreadId,
    reason: Schema.Literal("user"),
  }),
]);
export type OrchestrationV2Command = typeof OrchestrationV2Command.Type;

export const OrchestrationV2DispatchCommandResult = Schema.Struct({
  /** The last event the command produced. */
  sequence: NonNegativeInt,
});
export type OrchestrationV2DispatchCommandResult = typeof OrchestrationV2DispatchCommandResult.Type;

/** The command was refused, now or the first time its id was sent; `message` says why. */
export class OrchestrationDispatchCommandError extends Schema.TaggedError<OrchestrationDispatchCommandError>()(
  "OrchestrationDispatchCommandError",
  { commandId: CommandId, message: Schema.String },
) {}

export class OrchestrationThreadNotFoundError extends Schema.TaggedError<OrchestrationThreadNotFoundError>()(
  "OrchestrationThreadNotFoundError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return `Thread ${this.threadId} does not exist.`;
  }
}

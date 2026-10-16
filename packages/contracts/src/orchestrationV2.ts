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
 * Absent until their tickets: subagents, plans, checkpoints, context
 * handoffs, runtime requests (#25), interrupts (#24), model changes (#23).
 */

export const ORCHESTRATION_V2_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
} as const;

/** The provider instance and model a thread runs (T3 Code's `ModelSelection`, without options). */
export const ModelSelection = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
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
  kind: Schema.Literals(["root_turn", "assistant_message", "tool_call"]),
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
  /** Claude's session id, once a session has run the thread. */
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
 * messages, file changes, commands, other tools and errors. A `file_change`
 * carries the written content in `newStr`, which T3 Code's Claude adapter
 * leaves out.
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
});
export type OrchestrationV2ThreadShell = typeof OrchestrationV2ThreadShell.Type;

export const OrchestrationV2ShellSnapshot = Schema.Struct({
  /** The last application event the snapshot includes. */
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  /** Oldest first. */
  threads: Schema.Array(OrchestrationV2ThreadShell),
});
export type OrchestrationV2ShellSnapshot = typeof OrchestrationV2ShellSnapshot.Type;

/** The snapshot first, then each change after it. */
export const OrchestrationV2ShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationV2ShellSnapshot,
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
]);
export type OrchestrationV2ShellStreamItem = typeof OrchestrationV2ShellStreamItem.Type;

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
 * Full access and the default interaction mode. A message is plain text; the
 * first one's `titleSeed` titles the thread.
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
    type: Schema.Literal("message.dispatch"),
    commandId: CommandId,
    threadId: ThreadId,
    messageId: MessageId,
    text: TrimmedNonEmptyString,
    titleSeed: Schema.optionalKey(TrimmedNonEmptyString),
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

import type {
  MessageId,
  NodeId,
  ProviderSessionId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@playstead/contracts/baseSchemas";
import type {
  ModelSelection,
  OrchestrationV2ExecutionNode,
  OrchestrationV2ProviderFailure,
  OrchestrationV2ProviderSession,
  OrchestrationV2ProviderThread,
  OrchestrationV2TurnItem,
  ProviderInteractionMode,
  RuntimeMode,
} from "@playstead/contracts/orchestrationV2";
import { ProviderDriverKind, type ProviderInstanceId } from "@playstead/contracts/providerInstance";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

/**
 * How a provider runs a thread's turns, following T3 Code's
 * `packages/provider-core/src/server/ProviderAdapter.ts` at 2577baf. Each
 * provider's protocol stays behind its adapter; the orchestration core sees
 * only sessions, turns and the events below.
 *
 * Trimmed to starting turns. Steering, rollback and fork are absent; the
 * interrupt (#24), runtime-request answers (#25) and model changes (#23)
 * join this interface with their tickets.
 */

/** Every thread runs in Full access with the default interaction mode, in its project's folder. */
export interface ProviderAdapterV2RuntimePolicy {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly cwd: string;
}

export interface ProviderAdapterV2OpenSessionInput {
  readonly threadId: ThreadId;
  readonly providerSessionId: ProviderSessionId;
  readonly modelSelection: ModelSelection;
  readonly runtimePolicy: ProviderAdapterV2RuntimePolicy;
  /**
   * The provider's own id for a thread that has had turns before, such as
   * Claude's session id. The session continues that conversation instead of
   * starting a new one, as after a restart (T3 Code's `initialNativeThreadId`).
   */
  readonly initialNativeThreadId?: string;
}

export interface ProviderAdapterV2TurnInput {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly runOrdinal: number;
  readonly attemptId: RunAttemptId;
  readonly rootNodeId: NodeId;
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly providerTurnId: ProviderTurnId;
  readonly message: { readonly messageId: MessageId; readonly text: string };
  readonly modelSelection: ModelSelection;
  readonly runtimePolicy: ProviderAdapterV2RuntimePolicy;
}

/**
 * What an adapter reports while a turn runs. Items and nodes carry the run's
 * ids; the event sink gives each new item its ordinal. A turn ends with
 * exactly one `turn.terminal`.
 */
export type ProviderAdapterV2Event =
  | { readonly type: "node.updated"; readonly node: OrchestrationV2ExecutionNode }
  | { readonly type: "turn_item.updated"; readonly turnItem: OrchestrationV2TurnItem }
  | {
      readonly type: "turn.terminal";
      readonly providerTurnId: ProviderTurnId;
      readonly status: "completed" | "interrupted" | "cancelled";
      readonly failure: null;
    }
  | {
      readonly type: "turn.terminal";
      readonly providerTurnId: ProviderTurnId;
      readonly status: "failed";
      readonly failure: OrchestrationV2ProviderFailure;
    };

export class ProviderAdapterV2Error extends Schema.TaggedError<ProviderAdapterV2Error>()(
  "ProviderAdapterV2Error",
  {
    driver: ProviderDriverKind,
    operation: Schema.Literals(["open-session", "ensure-thread", "start-turn"]),
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

/** One provider session for one thread, open until its scope closes. */
export interface ProviderAdapterV2SessionRuntime {
  readonly driver: ProviderDriverKind;
  readonly providerSession: OrchestrationV2ProviderSession;
  /** False once the provider's process has gone; the next turn opens a new session. */
  readonly isLive: Effect.Effect<boolean>;
  /**
   * Events from now on. Subscribe before starting a turn so none of its
   * events are missed.
   */
  readonly subscribeEvents: Effect.Effect<
    Stream.Stream<ProviderAdapterV2Event>,
    never,
    Scope.Scope
  >;
  /** The provider thread with its native id, ready for a turn. */
  readonly ensureThread: (input: {
    readonly providerThread: OrchestrationV2ProviderThread;
  }) => Effect.Effect<OrchestrationV2ProviderThread, ProviderAdapterV2Error>;
  /** Sends the message; the turn's events follow on the session's events. */
  readonly startTurn: (
    input: ProviderAdapterV2TurnInput,
  ) => Effect.Effect<void, ProviderAdapterV2Error>;
}

export interface ProviderAdapterV2 {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly openSession: (
    input: ProviderAdapterV2OpenSessionInput,
  ) => Effect.Effect<ProviderAdapterV2SessionRuntime, ProviderAdapterV2Error, Scope.Scope>;
}

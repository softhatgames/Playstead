import type {
  NodeId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  TurnItemId,
} from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2Command,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
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
  /**
   * For a `message.dispatch` that implements a plan: the projection of the
   * thread its `sourcePlanRef` names, which may be another thread.
   */
  readonly sourcePlanThread?: OrchestrationV2ThreadProjection | undefined;
  /** For `message.dispatch`: whether the thread's adapter can queue a message behind an active run. */
  readonly supportsQueuedMessages: boolean;
  /** For `message.dispatch` and promotion: whether the thread's adapter can steer a running turn. */
  readonly supportsActiveSteering: boolean;
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

export type ThreadCommandResult = Result.Result<ThreadCommandDecision, ThreadCommandRejection>;

/** Everything a command decider is given. */
export interface ThreadCommandInput<Command extends OrchestrationV2Command> {
  readonly command: Command;
  readonly state: ThreadCommandState;
  readonly ids: ThreadCommandIds;
  readonly now: string;
}

export const reject = (command: OrchestrationV2Command, reason: string) =>
  Result.fail(new ThreadCommandRejection({ commandType: command.type, reason }));

/** The thread the command names, or the command refused because it does not exist. */
export const requireThread = (
  command: OrchestrationV2Command,
  state: ThreadCommandState,
): Result.Result<OrchestrationV2ThreadProjection, ThreadCommandRejection> =>
  state.projection === undefined
    ? reject(command, `Thread ${command.threadId} does not exist.`)
    : Result.succeed(state.projection);

/**
 * The queued run among `runs` with the id, or the command refused with
 * "<subject> <id> is not queued.".
 */
export const requireQueuedRun = (
  command: OrchestrationV2Command,
  runs: ReadonlyArray<OrchestrationV2Run>,
  runId: RunId,
  subject: string,
): Result.Result<OrchestrationV2Run, ThreadCommandRejection> => {
  const run = runs.find((candidate) => candidate.id === runId);
  return run === undefined || run.status !== "queued"
    ? reject(command, `${subject} ${runId} is not queued.`)
    : Result.succeed(run);
};

import type { RunId } from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
} from "@playstead/contracts/orchestrationV2";
import * as Result from "effect/Result";

import {
  reject,
  type ThreadCommandRejection,
  type ThreadCommandState,
} from "./ThreadCommandDecision.ts";

type MessageDispatchCommand = Extract<OrchestrationV2Command, { type: "message.dispatch" }>;
type MessageDispatchMode = MessageDispatchCommand["dispatchMode"];

/**
 * The dispatch mode a message's delivery intent leaves it (T3 Code's
 * `resolveMessageDispatchIntent`, `apps/server/src/orchestration-v2/CommandPolicy.ts`
 * at 2577baf, without `restart`): with nothing active the message starts a
 * run; `steer` steers the active run; `auto` queues behind a run still
 * starting, and otherwise steers when the provider can, else queues. T3
 * Code reads the live session's capabilities, Playstead the adapter's,
 * which are the same.
 */
export function resolveMessageDispatchIntent(
  projection: OrchestrationV2ThreadProjection,
  command: MessageDispatchCommand,
  state: ThreadCommandState,
): MessageDispatchMode {
  if (command.deliveryIntent === undefined) return command.dispatchMode;
  const active = projection.runs.findLast((run) => ACTIVE_RUN_STATUSES.has(run.status));
  if (active === undefined) return { type: "start_immediately" };
  if (command.deliveryIntent === "steer") return { type: "steer_active", targetRunId: active.id };
  if (active.status === "starting") return { type: "queue_after_active" };
  return state.supportsActiveSteering
    ? { type: "steer_active", targetRunId: active.id }
    : { type: "queue_after_active" };
}

/** What a message does (T3 Code's `MessageDispatchDecisionV2`, without restart). */
export type MessageDispatchDecision =
  | { readonly type: "start_run" }
  | { readonly type: "queue_after_active" }
  | { readonly type: "steer_active"; readonly targetRunId: RunId };

/**
 * What a message in a dispatch mode does (T3 Code's `decideMessageDispatch`
 * and `ensureQueuedMessages`): a steer goes to its target; otherwise the
 * message starts a run when no run is active, and waits behind the active
 * run when the provider can queue.
 */
export function decideMessageDispatch(
  command: MessageDispatchCommand,
  projection: OrchestrationV2ThreadProjection,
  dispatchMode: MessageDispatchMode,
  state: ThreadCommandState,
): Result.Result<MessageDispatchDecision, ThreadCommandRejection> {
  if (dispatchMode.type === "steer_active") {
    return Result.succeed({ type: "steer_active", targetRunId: dispatchMode.targetRunId });
  }
  const active = projection.runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status));
  if (active === undefined) return Result.succeed({ type: "start_run" });
  if (!state.supportsQueuedMessages) {
    return reject(
      command,
      `${projection.thread.providerInstanceId} cannot queue a message while run ${active.id} is active.`,
    );
  }
  return Result.succeed({ type: "queue_after_active" });
}

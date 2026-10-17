import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type OrchestrationV2AppThread,
  type OrchestrationV2ServerCommand,
} from "@playstead/contracts/orchestrationV2";
import * as Result from "effect/Result";

import { decideMessageDispatchCommand, decidePromoteToSteer } from "./MessageDispatch.ts";
import { decideQueueCommand } from "./QueueCommands.ts";
import { decideRunInterrupt } from "./RunInterrupt.ts";
import { decideRuntimeRequestRespond } from "./RuntimeRequestRespond.ts";
import {
  reject,
  type ThreadCommandInput,
  type ThreadCommandResult,
} from "./ThreadCommandDecision.ts";
import {
  decideThreadAutoSettle,
  decideThreadDelete,
  decideThreadMutation,
  decideThreadVisit,
} from "./ThreadLifecycle.ts";

/**
 * Decides a thread command's events and effects, without I/O. T3 Code at
 * 2577baf decides inside `OrchestratorV2`'s `dispatchThreadCreate`,
 * `dispatchThreadMutation` and `dispatchMessage`
 * (`apps/server/src/orchestration-v2/Orchestrator.ts`); Playstead keeps the
 * same events in the same order as pure functions, one module per kind of
 * command:
 *
 * - here, `thread.create`: a thread in its runtime and interaction modes,
 *   for an existing project and an instance that can run it;
 * - `ThreadLifecycle.ts`: everything that changes the thread itself (its
 *   model and modes, archive, rename and titles, read marker, pin, settle,
 *   snooze, automatic settlement and its sweep's settle), and
 *   `thread.delete`;
 * - `MessageDispatch.ts`: `message.dispatch` (start, steer or queue, as
 *   `CommandPolicy.ts` decides) and `queued-message.promote-to-steer`;
 * - `QueueCommands.ts`: `queue.resume` and the `queued-run.*` commands, and
 *   the next queued run to start after a run ends;
 * - `RunInterrupt.ts`: `run.interrupt`;
 * - `RuntimeRequestRespond.ts`: `runtime-request.respond`.
 *
 * Every command but `thread.create` needs the thread, and a deleted thread
 * refuses them all.
 */
export function decideThreadCommand(
  input: ThreadCommandInput<OrchestrationV2ServerCommand>,
): ThreadCommandResult {
  const { command, state } = input;
  if (command.type === "thread.create") return decideThreadCreate({ ...input, command });
  if (state.projection?.thread.deletedAt != null) {
    return reject(command, `Thread ${command.threadId} is deleted.`);
  }
  switch (command.type) {
    case "thread.model-selection.set":
    case "thread.runtime-mode.set":
    case "thread.interaction-mode.set":
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
      return decideThreadMutation({ ...input, command });
    case "thread.auto-settle":
      return decideThreadAutoSettle({ ...input, command });
    case "thread.visit":
      return decideThreadVisit({ ...input, command });
    case "thread.delete":
      return decideThreadDelete({ ...input, command });
    case "message.dispatch":
      return decideMessageDispatchCommand({ ...input, command });
    case "queued-message.promote-to-steer":
      return decidePromoteToSteer({ ...input, command });
    case "queue.resume":
    case "queued-run.reorder":
    case "queued-run.cancel":
    case "queued-run.edit":
      return decideQueueCommand({ ...input, command });
    case "run.interrupt":
      return decideRunInterrupt({ ...input, command });
    case "runtime-request.respond":
      return decideRuntimeRequestRespond({ ...input, command });
  }
}

function decideThreadCreate(
  input: ThreadCommandInput<Extract<OrchestrationV2ServerCommand, { type: "thread.create" }>>,
): ThreadCommandResult {
  const { command, state, now } = input;
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
    runtimeMode: command.runtimeMode,
    interactionMode: command.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
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
    worktreePath: null,
  };
  return Result.succeed({
    events: [{ type: "thread.created", threadId: thread.id, occurredAt: now, payload: thread }],
    effects: [],
  });
}

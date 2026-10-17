import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type OrchestrationV2AppThread,
  type OrchestrationV2Command,
} from "@playstead/contracts/orchestrationV2";
import * as Result from "effect/Result";

import { decideMessageDispatchCommand, decidePromoteToSteer } from "./MessageDispatch.ts";
import { decideQueueCommand } from "./QueueCommands.ts";
import { decideRunInterrupt } from "./RunInterrupt.ts";
import { decideRuntimeRequestRespond } from "./RuntimeRequestRespond.ts";
import {
  reject,
  requireThread,
  type ThreadCommandInput,
  type ThreadCommandResult,
} from "./ThreadCommandDecision.ts";

/**
 * Decides a thread command's events and effects, without I/O. T3 Code at
 * 2577baf decides inside `OrchestratorV2`'s `dispatchThreadCreate`,
 * `dispatchThreadMutation` and `dispatchMessage`
 * (`apps/server/src/orchestration-v2/Orchestrator.ts`); Playstead keeps the
 * same events in the same order as pure functions, one module per kind of
 * command:
 *
 * - here, the thread's own settings: `thread.create` makes a thread in its
 *   runtime and interaction modes, for an existing project and an instance
 *   that can run it; `thread.model-selection.set` changes the model the
 *   thread's next run copies (naming another instance is T3 Code's provider
 *   switch, which Playstead refuses); `thread.runtime-mode.set` and
 *   `thread.interaction-mode.set` change the modes the thread's next turn
 *   starts in, and as in T3 Code an active run prevents neither;
 * - `MessageDispatch.ts`: `message.dispatch` (start, steer or queue, as
 *   `CommandPolicy.ts` decides) and `queued-message.promote-to-steer`;
 * - `QueueCommands.ts`: `queue.resume` and the `queued-run.*` commands, and
 *   the next queued run to start after a run ends;
 * - `RunInterrupt.ts`: `run.interrupt`;
 * - `RuntimeRequestRespond.ts`: `runtime-request.respond`.
 */
export function decideThreadCommand(
  input: ThreadCommandInput<OrchestrationV2Command>,
): ThreadCommandResult {
  const { command } = input;
  switch (command.type) {
    case "thread.create":
      return decideThreadCreate({ ...input, command });
    case "thread.model-selection.set":
    case "thread.runtime-mode.set":
    case "thread.interaction-mode.set":
      return decideThreadSetting({ ...input, command });
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
  input: ThreadCommandInput<Extract<OrchestrationV2Command, { type: "thread.create" }>>,
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
  };
  return Result.succeed({
    events: [{ type: "thread.created", threadId: thread.id, occurredAt: now, payload: thread }],
    effects: [],
  });
}

type ThreadSettingCommand = Extract<
  OrchestrationV2Command,
  { type: "thread.model-selection.set" | "thread.runtime-mode.set" | "thread.interaction-mode.set" }
>;

const decideThreadSetting = (
  input: ThreadCommandInput<ThreadSettingCommand>,
): ThreadCommandResult =>
  Result.gen(function* () {
    const { command, state, now } = input;
    const { thread } = yield* requireThread(command, state);
    const base = { threadId: thread.id, occurredAt: now };
    switch (command.type) {
      case "thread.model-selection.set":
        if (command.modelSelection.instanceId !== thread.providerInstanceId) {
          return yield* reject(
            command,
            `Thread ${thread.id} runs on ${thread.providerInstanceId}. Choose one of its models; switching provider is not available yet.`,
          );
        }
        return {
          events: [
            {
              ...base,
              type: "thread.model-selection-updated",
              payload: { ...thread, modelSelection: command.modelSelection, updatedAt: now },
            },
          ],
          effects: [],
        };
      case "thread.runtime-mode.set":
        return {
          events: [
            {
              ...base,
              type: "thread.runtime-mode-updated",
              payload: { ...thread, runtimeMode: command.runtimeMode, updatedAt: now },
            },
          ],
          effects: [],
        };
      case "thread.interaction-mode.set":
        return {
          events: [
            {
              ...base,
              type: "thread.interaction-mode-updated",
              payload: { ...thread, interactionMode: command.interactionMode, updatedAt: now },
            },
          ],
          effects: [],
        };
    }
  });

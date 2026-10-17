import { deriveThreadTitleSeed } from "@playstead/client-runtime/operations/threadTitle";
import type {
  CommandId,
  MessageId,
  ProjectId,
  RunId,
  ThreadId,
} from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  type ModelSelection,
  type OrchestrationV2Command,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
} from "@playstead/contracts/orchestrationV2";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import type { ServerProvider, ServerProviderModel } from "@playstead/contracts/server";

export interface ModelPickerEntry {
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string;
  readonly models: ReadonlyArray<ServerProviderModel>;
}

/**
 * The model picker's providers, after T3 Code's `deriveProviderInstanceEntries`
 * and `deriveLockedProvider` (`apps/web/src/providerInstances.ts`,
 * `ChatView.logic.ts` at 2577baf): every installed provider with models
 * until the thread starts, then only the thread's own.
 */
export function deriveModelPickerEntries(
  providers: ReadonlyArray<ServerProvider>,
  lockedInstanceId: ProviderInstanceId | undefined,
): ReadonlyArray<ModelPickerEntry> {
  return providers
    .filter((provider) => provider.installed && provider.models.length > 0)
    .filter(
      (provider) => lockedInstanceId === undefined || provider.instanceId === lockedInstanceId,
    )
    .map((provider) => ({
      instanceId: provider.instanceId,
      displayName: provider.displayName,
      models: provider.models,
    }));
}

/** A new thread starts on the first provider's default model. */
export function defaultModelSelection(
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection | undefined {
  const entry = deriveModelPickerEntries(providers, undefined)[0];
  const model = entry?.models.find((candidate) => candidate.isDefault) ?? entry?.models[0];
  return entry === undefined || model === undefined
    ? undefined
    : { instanceId: entry.instanceId, model: model.slug };
}

export type SendTarget =
  | {
      /** A thread not on the server yet: its first send creates it. */
      readonly kind: "new";
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
      readonly modelSelection: ModelSelection;
    }
  | {
      readonly kind: "existing";
      readonly threadId: ThreadId;
      readonly hasMessages: boolean;
      /** The composer's model and traits, which the message makes the thread's. */
      readonly modelSelection: ModelSelection;
    };

/**
 * The model selection the composer shows and sends, as T3 Code's composer
 * draft resolves it: the traits chosen in this composer for the model, else
 * the thread's own, and for a new thread the traits remembered for the
 * model (T3 Code's sticky options).
 */
export function resolveComposerSelection(input: {
  readonly selection: ModelSelection | undefined;
  readonly chosen: ModelSelection | undefined;
  readonly recall: (
    instanceId: ModelSelection["instanceId"],
    model: string,
  ) => ModelSelection["options"];
  readonly isDraft: boolean;
}): ModelSelection | undefined {
  const { selection, chosen } = input;
  if (selection === undefined) return undefined;
  const base = { instanceId: selection.instanceId, model: selection.model };
  const options =
    chosen !== undefined &&
    chosen.instanceId === selection.instanceId &&
    chosen.model === selection.model
      ? chosen.options
      : (selection.options ??
        (input.isDraft ? input.recall(selection.instanceId, selection.model) : undefined));
  return options === undefined ? base : { ...base, options };
}

/**
 * The commands a send dispatches, in order. From a new thread that is
 * `thread.create` and then `message.dispatch`; T3 Code folds the first into
 * the message's `bootstrap`. The first message carries T3 Code's title seed.
 * A new thread is created with the composer's model and traits; a message
 * to a started thread carries them, as T3 Code's composer sends them.
 */
export function buildSendCommands(input: {
  readonly target: SendTarget;
  readonly text: string;
  readonly ids: {
    readonly threadCommandId: CommandId;
    readonly messageCommandId: CommandId;
    readonly messageId: MessageId;
  };
}): ReadonlyArray<OrchestrationV2Command> {
  const { target, ids } = input;
  const text = input.text.trim();
  const firstMessage = target.kind === "new" || !target.hasMessages;
  const message: OrchestrationV2Command = {
    type: "message.dispatch",
    commandId: ids.messageCommandId,
    threadId: target.threadId,
    messageId: ids.messageId,
    text,
    ...(firstMessage ? { titleSeed: deriveThreadTitleSeed(text) } : {}),
    ...(target.kind === "existing" ? { modelSelection: target.modelSelection } : {}),
  };
  if (target.kind === "existing") return [message];
  return [
    {
      type: "thread.create",
      commandId: ids.threadCommandId,
      threadId: target.threadId,
      projectId: target.projectId,
      title: "New thread",
      modelSelection: target.modelSelection,
    },
    message,
  ];
}

export type ComposerAction =
  | { readonly kind: "send" }
  | { readonly kind: "interrupt"; readonly runId: RunId }
  | { readonly kind: "interrupting" };

/**
 * The composer's one action (T3 Code's `ComposerPrimaryActions` at 2577baf,
 * without the queue or steering): send while no run is active; while one
 * is, only **Interrupt**, and once that is pressed, the run stopping.
 */
export function deriveComposerAction(
  runs: ReadonlyArray<OrchestrationV2Run>,
  turnItems: ReadonlyArray<OrchestrationV2TurnItem>,
): ComposerAction {
  const active = runs.findLast((run) => ACTIVE_RUN_STATUSES.has(run.status));
  if (active === undefined) return { kind: "send" };
  const requested = turnItems.some(
    (item) => item.type === "run_interrupt_request" && item.runId === active.id,
  );
  return requested ? { kind: "interrupting" } : { kind: "interrupt", runId: active.id };
}

/**
 * The model can change only while the composer can send: while a run is
 * active, **Interrupt** is the composer's one control.
 */
export function canChooseModel(action: ComposerAction): boolean {
  return action.kind === "send";
}

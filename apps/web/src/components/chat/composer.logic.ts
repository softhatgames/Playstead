import { deriveThreadTitleSeed } from "@playstead/client-runtime/operations/threadTitle";
import type { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { ModelSelection, OrchestrationV2Command } from "@playstead/contracts/orchestrationV2";
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
  | { readonly kind: "existing"; readonly threadId: ThreadId; readonly hasMessages: boolean };

/**
 * The commands a send dispatches, in order. From a new thread that is
 * `thread.create` and then `message.dispatch`; T3 Code folds the first into
 * the message's `bootstrap`. The first message carries T3 Code's title seed.
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

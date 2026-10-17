import { deriveThreadTitleSeed } from "@playstead/client-runtime/operations/threadTitle";
import type { ComposerDispatchMode } from "@playstead/client-runtime/state/composerDispatch";
import {
  CommandId,
  type MessageId,
  type ProjectId,
  type RunId,
  type ThreadId,
} from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ModelSelection,
  type OrchestrationV2Command,
  type OrchestrationV2Run,
  type OrchestrationV2SourcePlanRef,
  type OrchestrationV2TurnItem,
  type ProviderInteractionMode,
  type RuntimeMode,
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
      /** The mode the thread runs in on the server. */
      readonly runtimeMode: RuntimeMode;
      /** The thread's interaction mode on the server; `default` when left out. */
      readonly interactionMode?: ProviderInteractionMode;
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
 * `thread.create` in the composer's modes and then `message.dispatch`; T3
 * Code folds the first into the message's `bootstrap`. To a started thread
 * whose modes were changed in the composer, each changed mode goes first
 * (`thread.runtime-mode.set`, then `thread.interaction-mode.set`), as T3
 * Code's `persistThreadSettingsForNextTurn` sends them. The first message
 * carries T3 Code's title seed. A new thread is created with the composer's
 * model and traits; a message to a started thread carries them, as T3
 * Code's composer sends them. A message that implements a proposed plan
 * names it (`sourcePlanRef`). A message sent while a run is active is
 * queued behind it (`queue_after_active`), or steers it (`deliveryIntent:
 * "steer"`, which the server puts into the active run, or starts as a run
 * if the turn has ended); otherwise the server starts it, or puts it
 * behind or into a run that started meanwhile (`deliveryIntent: "auto"`).
 * Both go with `start_immediately`, as T3 Code's `startThreadTurn` sends them.
 */
export function buildSendCommands(input: {
  readonly target: SendTarget;
  /** The mode chosen in the composer. */
  readonly runtimeMode: RuntimeMode;
  /** The interaction mode chosen in the composer; `default` when left out. */
  readonly interactionMode?: ProviderInteractionMode;
  readonly dispatchMode: ComposerDispatchMode;
  readonly text: string;
  readonly sourcePlanRef?: OrchestrationV2SourcePlanRef;
  readonly ids: {
    readonly threadCommandId: CommandId;
    readonly messageCommandId: CommandId;
    readonly messageId: MessageId;
    readonly runtimeModeCommandId: CommandId;
    /** For a change of interaction mode; one is made from the message's when left out. */
    readonly interactionModeCommandId?: CommandId;
  };
}): ReadonlyArray<OrchestrationV2Command> {
  const { target, ids, runtimeMode } = input;
  const interactionMode = input.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE;
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
    ...(input.dispatchMode === "queue"
      ? { dispatchMode: { type: "queue_after_active" } }
      : { dispatchMode: { type: "start_immediately" }, deliveryIntent: input.dispatchMode }),
    ...(input.sourcePlanRef === undefined ? {} : { sourcePlanRef: input.sourcePlanRef }),
  };
  if (target.kind === "existing") {
    const commands: Array<OrchestrationV2Command> = [];
    if (target.runtimeMode !== runtimeMode) {
      commands.push({
        type: "thread.runtime-mode.set",
        commandId: ids.runtimeModeCommandId,
        threadId: target.threadId,
        runtimeMode,
      });
    }
    if ((target.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE) !== interactionMode) {
      commands.push({
        type: "thread.interaction-mode.set",
        commandId:
          ids.interactionModeCommandId ??
          CommandId.make(`${ids.messageCommandId}:interaction-mode`),
        threadId: target.threadId,
        interactionMode,
      });
    }
    return [...commands, message];
  }
  return [
    {
      type: "thread.create",
      commandId: ids.threadCommandId,
      threadId: target.threadId,
      projectId: target.projectId,
      title: "New thread",
      modelSelection: target.modelSelection,
      runtimeMode,
      ...(interactionMode === DEFAULT_PROVIDER_INTERACTION_MODE ? {} : { interactionMode }),
    },
    message,
  ];
}

export type ComposerAction =
  | { readonly kind: "send" }
  | { readonly kind: "queue" }
  | { readonly kind: "steer" }
  | { readonly kind: "update-queued" }
  | { readonly kind: "resume" }
  | { readonly kind: "interrupt"; readonly runId: RunId }
  | { readonly kind: "interrupting" };

/**
 * The composer's primary action (T3 Code's `ComposerPrimaryActions` at
 * 2577baf, without compaction). Editing a queued message saves it. While a
 * run is active an empty composer offers **Interrupt**, and once that is
 * pressed, the run stopping; with something typed, the follow-up: queueing
 * or steering. An empty composer offers **Resume**
 * after a stop or while the queue is held. Otherwise it sends.
 */
export function deriveComposerAction(input: {
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  readonly turnItems: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly hasContent: boolean;
  readonly editingQueuedMessage: boolean;
  readonly canResume: boolean;
  /** What a message sent now does: `resolveComposerDispatchMode`. */
  readonly dispatchMode: ComposerDispatchMode;
}): ComposerAction {
  if (input.editingQueuedMessage) return { kind: "update-queued" };
  const active = input.runs.findLast((run) => ACTIVE_RUN_STATUSES.has(run.status));
  if (active !== undefined && !input.hasContent) {
    const requested = input.turnItems.some(
      (item) => item.type === "run_interrupt_request" && item.runId === active.id,
    );
    return requested ? { kind: "interrupting" } : { kind: "interrupt", runId: active.id };
  }
  if (input.canResume && !input.hasContent) return { kind: "resume" };
  if (active !== undefined && input.dispatchMode === "queue") return { kind: "queue" };
  if (active !== undefined && input.dispatchMode === "steer") return { kind: "steer" };
  return { kind: "send" };
}

/**
 * The model and its traits can change for the next message at any time, as
 * in T3 Code; a queued message being edited keeps the selection it was
 * sent with.
 */
export function canChooseModel(action: ComposerAction): boolean {
  return action.kind !== "update-queued";
}

interface ShortcutKeys {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Whether a key press is `mod+shift+a`, T3 Code's default keybinding for
 * `composer.mode` (`packages/shared/src/keybindings.ts` at 2577baf), which
 * opens the mode picker. `mod` is Command on a Mac and Control elsewhere;
 * no other modifier may be held, as T3 Code's matcher requires.
 */
export function isComposerModeShortcut(event: ShortcutKeys, platform: string): boolean {
  const mac = /mac/i.test(platform);
  return (
    event.key.toLowerCase() === "a" &&
    event.shiftKey &&
    !event.altKey &&
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
  );
}

/**
 * Whether a key press is `mod+enter`, T3 Code's default keybinding for
 * `composer.sendAlternate` while a turn runs: it sends the follow-up that
 * Enter does not.
 */
export function isSendAlternateShortcut(event: ShortcutKeys, platform: string): boolean {
  const mac = /mac/i.test(platform);
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.altKey &&
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
  );
}

/**
 * Whether a key press is `mod+shift+enter`, T3 Code's default keybinding for
 * `thread.steerQueuedMessage`, which sends the first queued message as a steer.
 */
export function isSteerQueuedMessageShortcut(event: ShortcutKeys, platform: string): boolean {
  const mac = /mac/i.test(platform);
  return (
    event.key === "Enter" &&
    event.shiftKey &&
    !event.altKey &&
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
  );
}

/**
 * Whether a key press is `alt+arrowup`, T3 Code's default keybinding for
 * `thread.editQueuedMessage`, which opens the last queued message for editing.
 */
export function isEditQueuedMessageShortcut(event: ShortcutKeys): boolean {
  return (
    event.key === "ArrowUp" && event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey
  );
}

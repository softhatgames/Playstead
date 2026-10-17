import {
  CommandId,
  MessageId,
  type RunId,
  type RuntimeRequestId,
  type ThreadId,
} from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  type ModelSelection,
  type ProviderUserInputAnswers,
} from "@playstead/contracts/orchestrationV2";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { requestPrimary, usePrimaryConnectionState } from "../../connection/runtime.ts";
import { useThreadState } from "../../connection/useThread.ts";
import {
  clearComposerTraits,
  recallTraits,
  setComposerTraits,
  useComposerTraits,
} from "../../composerTraits.ts";
import { discardDraft, setDraftModelSelection, type ThreadDraft } from "../../drafts.ts";
import { newId } from "../../ids.ts";
import { ChatComposer } from "./ChatComposer.tsx";
import {
  buildSendCommands,
  defaultModelSelection,
  deriveComposerAction,
  deriveModelPickerEntries,
  resolveComposerSelection,
  type SendTarget,
} from "./composer.logic.ts";
import { traitsForDispatch } from "./traits.logic.ts";
import { MessagesTimeline } from "./MessagesTimeline.tsx";
import { derivePendingUserInputs } from "./pendingUserInput.logic.ts";
import { deriveTimelineRows } from "./timeline.logic.ts";

const sendCommands = async (target: SendTarget, text: string, threadCommandId: CommandId) => {
  const commands = buildSendCommands({
    target,
    text,
    ids: {
      threadCommandId,
      messageCommandId: CommandId.make(`command:${newId()}`),
      messageId: MessageId.make(`message:${newId()}`),
    },
  });
  for (const command of commands) {
    await requestPrimary((client) => client["orchestration.dispatchCommand"](command));
  }
};

/** A started thread's model, for its next turn (T3 Code's `thread.model-selection.set`). */
const setThreadModelSelection = (threadId: ThreadId, modelSelection: ModelSelection) =>
  requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      type: "thread.model-selection.set",
      commandId: CommandId.make(`command:${newId()}`),
      threadId,
      modelSelection,
    }),
  );

/** **Interrupt** for the thread's active run (T3 Code's `run.interrupt`). */
const interruptRun = (threadId: ThreadId, runId: RunId) =>
  requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      type: "run.interrupt",
      commandId: CommandId.make(`command:${newId()}`),
      threadId,
      runId,
    }),
  );

/** The person's answers to a provider's question (T3 Code's `runtime-request.respond`). */
const respondToUserInput = (
  threadId: ThreadId,
  requestId: RuntimeRequestId,
  answers: ProviderUserInputAnswers,
) =>
  requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      type: "runtime-request.respond",
      commandId: CommandId.make(`command:${newId()}`),
      threadId,
      requestId,
      answers,
    }),
  );

/**
 * The thread view: the chat column only, after T3 Code's `ChatView.tsx` at
 * 2577baf without its right-hand panel, terminal, diffs, branch toolbar or
 * thread details. A draft becomes a thread when its first message is sent,
 * and the view moves to it.
 */
export function ChatView(
  props:
    | { readonly kind: "draft"; readonly draft: ThreadDraft }
    | { readonly kind: "thread"; readonly threadId: ThreadId },
) {
  const navigate = useNavigate();
  const connection = usePrimaryConnectionState();
  const providers = connection?.config?.providers ?? [];
  const threadId = props.kind === "thread" ? props.threadId : props.draft.threadId;
  const { state, error } = useThreadState(threadId, props.kind === "thread");
  const projection = state?.projection;
  const projectId = props.kind === "draft" ? props.draft.projectId : projection?.thread.projectId;
  const project = connection?.shell?.projects.find((candidate) => candidate.id === projectId);

  const rows = useMemo(
    () => deriveTimelineRows(projection?.turnItems ?? [], project?.workspaceRoot),
    [projection?.turnItems, project?.workspaceRoot],
  );
  const working = projection?.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status)) ?? false;
  const action = deriveComposerAction(projection?.runs ?? [], projection?.turnItems ?? []);
  const pendingUserInput = useMemo(
    () =>
      derivePendingUserInputs(projection?.runtimeRequests ?? [], projection?.turnItems ?? [])[0],
    [projection?.runtimeRequests, projection?.turnItems],
  );
  const lockedInstanceId = projection?.thread.providerInstanceId;
  const entries = deriveModelPickerEntries(providers, lockedInstanceId);
  const composerKey = props.kind === "draft" ? props.draft.draftId : props.threadId;
  const chosenTraits = useComposerTraits(composerKey);
  const selection = resolveComposerSelection({
    selection:
      props.kind === "draft"
        ? (props.draft.modelSelection ?? defaultModelSelection(providers))
        : projection?.thread.modelSelection,
    chosen: chosenTraits,
    recall: recallTraits,
    isDraft: props.kind === "draft",
  });
  // What a message carries: only the traits chosen, read against the model's options.
  const capabilities = entries
    .find((entry) => entry.instanceId === selection?.instanceId)
    ?.models.find((model) => model.slug === selection?.model)?.capabilities;
  const dispatchOptions =
    selection === undefined ? undefined : traitsForDispatch(capabilities, selection.options);
  const dispatchSelection =
    selection === undefined
      ? undefined
      : {
          instanceId: selection.instanceId,
          model: selection.model,
          ...(dispatchOptions === undefined ? {} : { options: dispatchOptions }),
        };

  const onSend = async (text: string) => {
    if (dispatchSelection === undefined) return;
    if (props.kind === "thread") {
      await sendCommands(
        {
          kind: "existing",
          threadId: props.threadId,
          hasMessages: (projection?.messages.length ?? 0) > 0,
          modelSelection: dispatchSelection,
        },
        text,
        CommandId.make(`command:${newId()}`),
      );
      clearComposerTraits(composerKey);
      return;
    }
    const { draft } = props;
    await sendCommands(
      {
        kind: "new",
        threadId: draft.threadId,
        projectId: draft.projectId,
        modelSelection: dispatchSelection,
      },
      text,
      draft.threadCommandId,
    );
    clearComposerTraits(composerKey);
    await navigate({
      to: "/threads/$threadId",
      params: { threadId: draft.threadId },
      replace: true,
    });
    discardDraft(draft.draftId);
  };

  const title = projection?.thread.title ?? "New thread";
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline gap-2 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
        <h1 className="truncate text-sm font-medium">{title}</h1>
        {project === undefined ? null : (
          <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {project.title}
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error === undefined ? (
          <MessagesTimeline rows={rows} working={working} />
        ) : (
          <p className="px-6 py-6 text-sm text-neutral-600 dark:text-neutral-300">{error}</p>
        )}
      </div>
      <ChatComposer
        entries={entries}
        selection={selection}
        onSelectModel={(picked) => {
          // A model picked comes with the traits remembered for it, as T3 Code's does.
          const remembered = recallTraits(picked.instanceId, picked.model);
          const next = remembered === undefined ? picked : { ...picked, options: remembered };
          clearComposerTraits(composerKey);
          return props.kind === "draft"
            ? setDraftModelSelection(props.draft.draftId, next)
            : setThreadModelSelection(props.threadId, next).then(() => undefined);
        }}
        onTraitsChange={(options) => {
          if (selection !== undefined) setComposerTraits(composerKey, selection, options);
        }}
        action={action}
        onSend={onSend}
        onInterrupt={(runId) => interruptRun(threadId, runId).then(() => undefined)}
        pendingUserInput={pendingUserInput}
        onRespondToUserInput={(requestId, answers) =>
          respondToUserInput(threadId, requestId, answers).then(() => undefined)
        }
      />
    </div>
  );
}

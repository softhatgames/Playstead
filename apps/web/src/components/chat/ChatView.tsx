import type { ComposerDispatchMode } from "@playstead/client-runtime/state/composerDispatch";
import {
  deriveThreadQueueWorkflowState,
  resolveResumableRunId,
} from "@playstead/client-runtime/state/threadWorkflows";
import {
  CommandId,
  MessageId,
  type RunId,
  type RuntimeRequestId,
  type ThreadId,
} from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  DEFAULT_RUNTIME_MODE,
  type ModelSelection,
  type ProviderApprovalDecision,
  type ProviderUserInputAnswers,
  type RuntimeMode,
} from "@playstead/contracts/orchestrationV2";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { useClientSettings } from "../../clientSettings.ts";
import { requestPrimary, usePrimaryConnectionState } from "../../connection/runtime.ts";
import { useThreadState } from "../../connection/useThread.ts";
import {
  clearComposerTraits,
  recallTraits,
  setComposerTraits,
  useComposerTraits,
} from "../../composerTraits.ts";
import {
  clearComposerRuntimeMode,
  discardDraft,
  setComposerRuntimeMode,
  setDraftModelSelection,
  setDraftRuntimeMode,
  type ThreadDraft,
  useComposerRuntimeMode,
} from "../../drafts.ts";
import { newId } from "../../ids.ts";
import { ChatComposer } from "./ChatComposer.tsx";
import {
  buildSendCommands,
  defaultModelSelection,
  deriveModelPickerEntries,
  resolveComposerSelection,
  type SendTarget,
} from "./composer.logic.ts";
import { traitsForDispatch } from "./traits.logic.ts";
import { MessagesTimeline } from "./MessagesTimeline.tsx";
import { derivePendingApprovals } from "./pendingApproval.logic.ts";
import { derivePendingUserInputs } from "./pendingUserInput.logic.ts";
import { deriveTimelineRows } from "./timeline.logic.ts";

const sendCommands = async (
  target: SendTarget,
  runtimeMode: RuntimeMode,
  dispatchMode: ComposerDispatchMode,
  text: string,
  threadCommandId: CommandId,
) => {
  const commands = buildSendCommands({
    target,
    runtimeMode,
    dispatchMode,
    text,
    ids: {
      threadCommandId,
      messageCommandId: CommandId.make(`command:${newId()}`),
      messageId: MessageId.make(`message:${newId()}`),
      runtimeModeCommandId: CommandId.make(`command:${newId()}`),
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

/**
 * **Interrupt** for the thread's active run, which holds the queue behind it
 * (T3 Code's `interruptThreadTurn` sends `run.interrupt` with `holdQueue`).
 */
const interruptRun = (threadId: ThreadId, runId: RunId) =>
  requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      type: "run.interrupt",
      commandId: CommandId.make(`command:${newId()}`),
      threadId,
      runId,
      holdQueue: true,
    }),
  );

/** One of the queue's commands, with a new command id. */
const dispatchQueueCommand = (
  command:
    | { readonly type: "queue.resume"; readonly threadId: ThreadId }
    | {
        readonly type: "queued-run.reorder";
        readonly threadId: ThreadId;
        readonly runId: RunId;
        readonly beforeRunId: RunId | null;
      }
    | { readonly type: "queued-run.cancel"; readonly threadId: ThreadId; readonly runId: RunId }
    | {
        readonly type: "queued-run.edit";
        readonly threadId: ThreadId;
        readonly runId: RunId;
        readonly text: string;
      },
) =>
  requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      ...command,
      commandId: CommandId.make(`command:${newId()}`),
    }),
  ).then(() => undefined);
/** The person's decision on a provider's approval (T3 Code's `respondToThreadApproval`). */
const respondToApproval = (
  threadId: ThreadId,
  requestId: RuntimeRequestId,
  decision: ProviderApprovalDecision,
) =>
  requestPrimary((client) =>
    client["orchestration.dispatchCommand"]({
      type: "runtime-request.respond",
      commandId: CommandId.make(`command:${newId()}`),
      threadId,
      requestId,
      decision,
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
  const { followUpBehavior } = useClientSettings();
  const queue = useMemo(
    () =>
      deriveThreadQueueWorkflowState({
        runs: projection?.runs ?? [],
        messages: projection?.messages ?? [],
      }),
    [projection?.runs, projection?.messages],
  );
  const resumableRunId =
    projection === undefined ? null : resolveResumableRunId({ runs: projection.runs });
  const pendingApprovals = useMemo(
    () => derivePendingApprovals(projection?.runtimeRequests ?? [], projection?.turnItems ?? []),
    [projection?.runtimeRequests, projection?.turnItems],
  );
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
  // The mode chosen in the composer, else the thread's own (T3 Code's
  // composer draft over the thread's `runtimeMode`).
  const composerRuntimeMode = useComposerRuntimeMode(threadId);
  const threadRuntimeMode = projection?.thread.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const runtimeMode =
    props.kind === "draft" ? props.draft.runtimeMode : (composerRuntimeMode ?? threadRuntimeMode);

  const onSend = async (text: string, dispatchMode: ComposerDispatchMode) => {
    if (dispatchSelection === undefined) return;
    if (props.kind === "thread") {
      await sendCommands(
        {
          kind: "existing",
          threadId: props.threadId,
          hasMessages: (projection?.messages.length ?? 0) > 0,
          runtimeMode: threadRuntimeMode,
          modelSelection: dispatchSelection,
        },
        runtimeMode,
        dispatchMode,
        text,
        CommandId.make(`command:${newId()}`),
      );
      clearComposerTraits(composerKey);
      clearComposerRuntimeMode(props.threadId);
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
      runtimeMode,
      dispatchMode,
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

  /**
   * **Resume** (T3 Code's `onResume` in `ChatView.tsx`): after a stop it
   * continues the interrupted run with "Continue where you left off.", in
   * the composer's mode and model, then releases a held queue behind it;
   * with only a held queue, it releases that.
   */
  const onResume = async () => {
    if (props.kind !== "thread") return;
    if (resumableRunId !== null && dispatchSelection !== undefined) {
      const commands = buildSendCommands({
        target: {
          kind: "existing",
          threadId: props.threadId,
          hasMessages: true,
          runtimeMode: threadRuntimeMode,
          modelSelection: dispatchSelection,
        },
        runtimeMode,
        dispatchMode: "auto",
        text: "Continue where you left off.",
        ids: {
          threadCommandId: CommandId.make(`command:${newId()}`),
          messageCommandId: CommandId.make(`command:${newId()}`),
          messageId: MessageId.make(`message:${newId()}`),
          runtimeModeCommandId: CommandId.make(`command:${newId()}`),
        },
      });
      for (const command of commands) {
        await requestPrimary((client) =>
          client["orchestration.dispatchCommand"](
            command.type === "message.dispatch"
              ? {
                  ...command,
                  dispatchMode: { type: "start_immediately" },
                  manualContinuationOfRunId: resumableRunId,
                }
              : command,
          ),
        );
      }
      clearComposerRuntimeMode(props.threadId);
      if (!queue.isHeld) return;
    }
    await dispatchQueueCommand({ type: "queue.resume", threadId: props.threadId });
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
        runtimeMode={runtimeMode}
        onSelectRuntimeMode={(next) =>
          props.kind === "draft"
            ? setDraftRuntimeMode(props.draft.draftId, next)
            : setComposerRuntimeMode(props.threadId, next)
        }
        runs={projection?.runs ?? []}
        turnItems={projection?.turnItems ?? []}
        followUpBehavior={followUpBehavior}
        onSend={onSend}
        onInterrupt={(runId) => interruptRun(threadId, runId).then(() => undefined)}
        canResume={props.kind === "thread" && (resumableRunId !== null || queue.isHeld)}
        onResume={onResume}
        queuedRuns={queue.queuedRuns}
        onReorderQueuedRun={(runId, beforeRunId) =>
          dispatchQueueCommand({ type: "queued-run.reorder", threadId, runId, beforeRunId })
        }
        onRemoveQueuedRun={(runId) =>
          dispatchQueueCommand({ type: "queued-run.cancel", threadId, runId })
        }
        onUpdateQueuedRun={(runId, text) =>
          dispatchQueueCommand({ type: "queued-run.edit", threadId, runId, text })
        }
        pendingApprovals={pendingApprovals}
        onRespondToApproval={(requestId, decision) =>
          respondToApproval(threadId, requestId, decision).then(() => undefined)
        }
        pendingUserInput={pendingUserInput}
        onRespondToUserInput={(requestId, answers) =>
          respondToUserInput(threadId, requestId, answers).then(() => undefined)
        }
      />
    </div>
  );
}

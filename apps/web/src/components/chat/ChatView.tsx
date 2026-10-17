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
  ThreadId,
} from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  DEFAULT_RUNTIME_MODE,
  type ModelSelection,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2Command,
  type OrchestrationV2SourcePlanRef,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderUserInputAnswers,
  type RuntimeMode,
} from "@playstead/contracts/orchestrationV2";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

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
  clearComposerInteractionMode,
  clearComposerRuntimeMode,
  discardDraft,
  setComposerInteractionMode,
  setComposerRuntimeMode,
  setDraftInteractionMode,
  setDraftModelSelection,
  setDraftRuntimeMode,
  type ThreadDraft,
  useComposerInteractionMode,
  useComposerRuntimeMode,
} from "../../drafts.ts";
import { type ThreadLifecycleTarget, visitThread } from "../../hooks/useThreadActions.ts";
import { useThreadShortcuts } from "../../hooks/useThreadShortcuts.ts";
import { newId } from "../../ids.ts";
import {
  buildPlanImplementationPrompt,
  buildPlanImplementationThreadTitle,
  proposedPlanTitle,
  resolvePlanFollowUpSubmission,
} from "../../proposedPlan.ts";
import { ChatComposer } from "./ChatComposer.tsx";
import { ChatHeader } from "./ChatHeader.tsx";
import { ThreadStatusLine } from "./ThreadStatusLine.tsx";
import { DraftHeroHeadline } from "./DraftHeroHeadline.tsx";
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
import { resolveThreadVisit } from "./threadVisit.logic.ts";
import {
  deriveActiveTasks,
  findLatestProposedPlan,
  resolveComposerInteractionMode,
  shouldShowPlanFollowUpPrompt,
} from "./plan.logic.ts";
import { deriveTimelineRows } from "./timeline.logic.ts";

/**
 * Sends `thread.visit` while the thread is in view, as `resolveThreadVisit`
 * decides from the sidebar's copy of the thread (T3 Code's visit effect in
 * `ChatView.tsx` at 2577baf, which reads the shell too). A failed visit is
 * not reported, as in T3 Code.
 */
function useThreadVisits(thread: OrchestrationV2ThreadShell | undefined) {
  const lastDispatchedKey = useRef<string | null>(null);
  const lastDispatchAt = useRef(0);
  const threadId = thread?.id;
  const updatedAt = thread?.updatedAt;
  const lastVisitedAt = thread?.lastVisitedAt;
  const latestRunCompletedAt = thread?.latestRunCompletedAt;
  useEffect(() => {
    if (
      threadId === undefined ||
      updatedAt === undefined ||
      lastVisitedAt === undefined ||
      latestRunCompletedAt === undefined
    ) {
      return;
    }
    const decision = resolveThreadVisit({
      thread: { id: threadId, updatedAt, lastVisitedAt, latestRunCompletedAt },
      lastDispatchedKey: lastDispatchedKey.current,
      lastDispatchAt: lastDispatchAt.current,
      now: Date.now(),
    });
    if (decision.kind === "none") return;
    const dispatch = () => {
      lastDispatchedKey.current = decision.key;
      lastDispatchAt.current = Date.now();
      visitThread(threadId, decision.visitedAt).catch(() => undefined);
    };
    if (decision.kind === "now") {
      dispatch();
      return;
    }
    const timer = setTimeout(dispatch, decision.delayMs);
    return () => clearTimeout(timer);
  }, [threadId, updatedAt, lastVisitedAt, latestRunCompletedAt]);
}

const sendCommands = async (
  target: SendTarget,
  runtimeMode: RuntimeMode,
  dispatchMode: ComposerDispatchMode,
  text: string,
  threadCommandId: CommandId,
  plan: {
    readonly interactionMode: ProviderInteractionMode;
    readonly sourcePlanRef?: OrchestrationV2SourcePlanRef;
  },
) => {
  const commands = buildSendCommands({
    target,
    runtimeMode,
    interactionMode: plan.interactionMode,
    dispatchMode,
    text,
    ...(plan.sourcePlanRef === undefined ? {} : { sourcePlanRef: plan.sourcePlanRef }),
    ids: {
      threadCommandId,
      messageCommandId: CommandId.make(`command:${newId()}`),
      messageId: MessageId.make(`message:${newId()}`),
      runtimeModeCommandId: CommandId.make(`command:${newId()}`),
      interactionModeCommandId: CommandId.make(`command:${newId()}`),
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
        readonly type: "queued-message.promote-to-steer";
        readonly threadId: ThreadId;
        readonly queuedRunId: RunId;
        readonly targetRunId: RunId;
      }
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
 * and the view moves to it. A thread's header opens its menu, from the
 * title's chevron or a right-click (T3 Code's `ChatHeader.tsx`).
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
  const { followUpBehavior, planModeEnabled } = useClientSettings();
  const queue = useMemo(
    () =>
      deriveThreadQueueWorkflowState({
        runs: projection?.runs ?? [],
        messages: projection?.messages ?? [],
        providerTurns: projection?.providerTurns ?? [],
      }),
    [projection?.runs, projection?.messages, projection?.providerTurns],
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

  // Plan or build: the composer's choice, else the thread's own, and only
  // with **Plan mode (legacy)** on (T3 Code's `resolveComposerInteractionMode`).
  const composerInteractionMode = useComposerInteractionMode(threadId);
  const threadInteractionMode = projection?.thread.interactionMode ?? "default";
  const { enabled: interactionModeEnabled, interactionMode } = resolveComposerInteractionMode({
    planModeEnabled,
    interactionMode:
      props.kind === "draft"
        ? props.draft.interactionMode
        : (composerInteractionMode ?? threadInteractionMode),
  });
  const onInteractionModeChange = (mode: ProviderInteractionMode) => {
    if (!interactionModeEnabled) return;
    if (props.kind === "draft") setDraftInteractionMode(props.draft.draftId, mode);
    else setComposerInteractionMode(props.threadId, mode);
  };

  // The plan the banner and **Implement** act on, once the turn has settled.
  const plans = projection?.plans ?? [];
  const activeRun = projection?.runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status));
  const latestRun = projection?.runs.reduce<(typeof projection.runs)[number] | undefined>(
    (latest, run) =>
      run.status !== "queued" && (latest === undefined || run.ordinal > latest.ordinal)
        ? run
        : latest,
    undefined,
  );
  const latestRunSettled = activeRun === undefined;
  const activeProposedPlan = latestRunSettled
    ? findLatestProposedPlan(plans, latestRun?.id)
    : undefined;
  const showPlanFollowUp =
    props.kind === "thread" &&
    shouldShowPlanFollowUpPrompt({
      pendingUserInputCount: pendingUserInput === undefined ? 0 : 1,
      interactionMode,
      latestRunSettled,
      hasActionableProposedPlan: activeProposedPlan?.status === "active",
    });
  const tasks = useMemo(() => deriveActiveTasks(plans, activeRun?.id), [plans, activeRun?.id]);

  const onSend = async (text: string, dispatchMode: ComposerDispatchMode) => {
    if (dispatchSelection === undefined) return;
    if (props.kind === "thread") {
      // With a plan ready, a send implements it or refines it (T3 Code's
      // `onSubmitPlanFollowUp`).
      const followUp =
        showPlanFollowUp && activeProposedPlan !== undefined
          ? resolvePlanFollowUpSubmission({
              draftText: text,
              planMarkdown: activeProposedPlan.markdown,
            })
          : undefined;
      await sendCommands(
        {
          kind: "existing",
          threadId: props.threadId,
          hasMessages: (projection?.messages.length ?? 0) > 0,
          runtimeMode: threadRuntimeMode,
          interactionMode: threadInteractionMode,
          modelSelection: dispatchSelection,
        },
        runtimeMode,
        dispatchMode,
        followUp?.text ?? text,
        CommandId.make(`command:${newId()}`),
        {
          interactionMode: followUp?.interactionMode ?? interactionMode,
          ...(followUp?.interactionMode === "default" && activeProposedPlan !== undefined
            ? { sourcePlanRef: { threadId: props.threadId, planId: activeProposedPlan.id } }
            : {}),
        },
      );
      clearComposerTraits(composerKey);
      clearComposerRuntimeMode(props.threadId);
      clearComposerInteractionMode(props.threadId);
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
      { interactionMode },
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

  /**
   * **Implement in a new thread** (T3 Code's `onImplementPlanInNewThread`):
   * a thread in the same project, titled after the plan, in the default
   * permissions and the build mode, whose first message is the plan,
   * naming it so it completes; then the view moves there.
   */
  const onImplementInNewThread = async () => {
    if (
      props.kind !== "thread" ||
      projection === undefined ||
      activeProposedPlan === undefined ||
      dispatchSelection === undefined
    ) {
      return;
    }
    const nextThreadId = ThreadId.make(`thread:${newId()}`);
    const title = buildPlanImplementationThreadTitle(activeProposedPlan.markdown);
    const commands: ReadonlyArray<OrchestrationV2Command> = [
      {
        type: "thread.create",
        commandId: CommandId.make(`command:${newId()}`),
        threadId: nextThreadId,
        projectId: projection.thread.projectId,
        title,
        modelSelection: dispatchSelection,
        runtimeMode: connection?.config?.settings.defaultRuntimeMode ?? DEFAULT_RUNTIME_MODE,
        interactionMode: "default",
      },
      {
        type: "message.dispatch",
        commandId: CommandId.make(`command:${newId()}`),
        threadId: nextThreadId,
        messageId: MessageId.make(`message:${newId()}`),
        text: buildPlanImplementationPrompt(activeProposedPlan.markdown),
        titleSeed: title,
        dispatchMode: { type: "start_immediately" },
        sourcePlanRef: { threadId: props.threadId, planId: activeProposedPlan.id },
      },
    ];
    for (const command of commands) {
      await requestPrimary((client) => client["orchestration.dispatchCommand"](command));
    }
    clearComposerTraits(composerKey);
    await navigate({ to: "/threads/$threadId", params: { threadId: nextThreadId } });
  };

  /** **Save to workspace**: the plan as a file in the project's folder. */
  const savePlanToWorkspace = async (relativePath: string, contents: string) => {
    if (project === undefined) throw new Error("This thread has no project folder.");
    const saved = await requestPrimary((client) =>
      client["projects.writeFile"]({ cwd: project.workspaceRoot, relativePath, contents }),
    );
    return saved.relativePath;
  };

  const title = projection?.thread.title ?? "New thread";
  // The latest run that left the queue, as the sidebar's shell counts it.
  const target = useMemo(
    (): ThreadLifecycleTarget | null =>
      projection === undefined
        ? null
        : {
            id: projection.thread.id,
            projectId: projection.thread.projectId,
            title: projection.thread.title,
            status: latestRun?.status ?? "idle",
            pinnedAt: projection.thread.pinnedAt,
            pinOrderKey: projection.thread.pinOrderKey,
            settledOverride: projection.thread.settledOverride,
            snoozedUntil: projection.thread.snoozedUntil,
            snoozedAt: projection.thread.snoozedAt,
            latestRunCompletedAt: latestRun?.completedAt ?? null,
            hasPendingUserInput: projection.runtimeRequests.some(
              (request) => request.status === "pending",
            ),
            autoSettleDisabledAt: projection.thread.autoSettleDisabledAt,
            titleRegeneration: projection.thread.titleRegeneration,
          },
    [projection, latestRun?.status, latestRun?.completedAt],
  );
  useThreadShortcuts(target);
  const threadShell =
    props.kind === "thread"
      ? connection?.shell?.threads.find((candidate) => candidate.id === props.threadId)
      : undefined;
  useThreadVisits(threadShell);
  return (
    <div className="flex h-full flex-col">
      <ChatHeader title={title} projectTitle={project?.title} thread={target} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.kind === "draft" ? (
          <DraftHeroHeadline draft={props.draft} />
        ) : error === undefined ? (
          <MessagesTimeline
            rows={rows}
            working={working}
            workspaceRoot={project?.workspaceRoot}
            onSavePlan={savePlanToWorkspace}
          />
        ) : (
          <p className="px-6 py-6 text-sm text-neutral-600 dark:text-neutral-300">{error}</p>
        )}
      </div>
      <ThreadStatusLine thread={threadShell} />
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
        canPromoteToSteer={queue.canPromoteToSteer}
        onSteerQueuedRun={(queuedRunId) =>
          queue.activeRun === null
            ? Promise.resolve()
            : dispatchQueueCommand({
                type: "queued-message.promote-to-steer",
                threadId,
                queuedRunId,
                targetRunId: queue.activeRun.id,
              })
        }
        pendingApprovals={pendingApprovals}
        onRespondToApproval={(requestId, decision) =>
          respondToApproval(threadId, requestId, decision).then(() => undefined)
        }
        pendingUserInput={pendingUserInput}
        onRespondToUserInput={(requestId, answers) =>
          respondToUserInput(threadId, requestId, answers).then(() => undefined)
        }
        interactionMode={interactionMode}
        interactionModeEnabled={interactionModeEnabled}
        onInteractionModeChange={onInteractionModeChange}
        planFollowUp={
          showPlanFollowUp && activeProposedPlan !== undefined
            ? { title: proposedPlanTitle(activeProposedPlan.markdown) }
            : undefined
        }
        onImplementInNewThread={onImplementInNewThread}
        tasks={tasks}
      />
    </div>
  );
}

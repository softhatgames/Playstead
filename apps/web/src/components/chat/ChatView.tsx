import { CommandId, MessageId, type ThreadId } from "@playstead/contracts/baseSchemas";
import { ACTIVE_RUN_STATUSES, type ModelSelection } from "@playstead/contracts/orchestrationV2";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { requestPrimary, usePrimaryConnectionState } from "../../connection/runtime.ts";
import { useThreadState } from "../../connection/useThread.ts";
import { discardDraft, setDraftModelSelection, type ThreadDraft } from "../../drafts.ts";
import { newId } from "../../ids.ts";
import { ChatComposer } from "./ChatComposer.tsx";
import {
  buildSendCommands,
  defaultModelSelection,
  deriveModelPickerEntries,
  type SendTarget,
} from "./composer.logic.ts";
import { MessagesTimeline } from "./MessagesTimeline.tsx";
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
  const lockedInstanceId = projection?.thread.providerInstanceId;
  const entries = deriveModelPickerEntries(providers, lockedInstanceId);
  const selection =
    props.kind === "draft"
      ? (props.draft.modelSelection ?? defaultModelSelection(providers))
      : projection?.thread.modelSelection;

  const onSend = async (text: string) => {
    if (props.kind === "thread") {
      await sendCommands(
        {
          kind: "existing",
          threadId: props.threadId,
          hasMessages: (projection?.messages.length ?? 0) > 0,
        },
        text,
        CommandId.make(`command:${newId()}`),
      );
      return;
    }
    if (selection === undefined) return;
    const { draft } = props;
    await sendCommands(
      {
        kind: "new",
        threadId: draft.threadId,
        projectId: draft.projectId,
        modelSelection: selection,
      },
      text,
      draft.threadCommandId,
    );
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
        onSelectModel={
          props.kind === "draft"
            ? (next) => setDraftModelSelection(props.draft.draftId, next)
            : (next) => setThreadModelSelection(props.threadId, next).then(() => undefined)
        }
        working={working}
        onSend={onSend}
      />
    </div>
  );
}

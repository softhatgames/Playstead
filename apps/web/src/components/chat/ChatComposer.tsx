import type { RuntimeRequestId } from "@playstead/contracts/baseSchemas";
import type {
  ModelSelection,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
  RuntimeMode,
} from "@playstead/contracts/orchestrationV2";
import { type KeyboardEvent, useCallback, useEffect, useState } from "react";

import { ArrowUpIcon } from "../icons.tsx";
import {
  canChooseModel,
  type ComposerAction,
  isComposerModeShortcut,
  type ModelPickerEntry,
} from "./composer.logic.ts";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel.tsx";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel.tsx";
import type { PendingApproval } from "./pendingApproval.logic.ts";
import type { PendingUserInput } from "./pendingUserInput.logic.ts";
import { ProviderModelPicker } from "./ProviderModelPicker.tsx";
import { RuntimeModePicker } from "./RuntimeModePicker.tsx";
import { TraitsPicker } from "./TraitsPicker.tsx";

const errorMessage = (cause: unknown, fallback: string) =>
  typeof cause === "object" && cause !== null && "message" in cause
    ? String(cause.message)
    : fallback;

/**
 * The plain-text composer, after T3 Code's `ChatComposer.tsx` and
 * `ComposerPrimaryActions.tsx` at 2577baf without rich text, attachments,
 * chips, commands, the queue or steering. Enter sends and Shift+Enter starts
 * a new line. While a run is active nothing can be sent: the one action is
 * **Interrupt**, and once pressed the composer says the run is stopping. An
 * approval the provider waits on shows above it, in the approval panel, the
 * oldest first; else a question, in the pending user-input panel (T3 Code's
 * `ChatComposer` renders them there too, the approval first).
 * Beside the model picker are the reasoning and traits picker for the
 * selected model, which can rewrite the prompt for Ultrathink, and the mode
 * picker, which `mod+shift+a` opens; a mode chosen there goes with the next
 * message, even while a run is active.
 */
export function ChatComposer(props: {
  readonly entries: ReadonlyArray<ModelPickerEntry>;
  readonly selection: ModelSelection | undefined;
  readonly onSelectModel: (selection: ModelSelection) => void | Promise<void>;
  /** The traits picker's new choices for the selected model. */
  readonly onTraitsChange: (options: ModelSelection["options"]) => void;
  readonly runtimeMode: RuntimeMode;
  readonly onSelectRuntimeMode: (mode: RuntimeMode) => void;
  readonly action: ComposerAction;
  readonly onSend: (text: string) => Promise<void>;
  readonly onInterrupt: (
    runId: Extract<ComposerAction, { kind: "interrupt" }>["runId"],
  ) => Promise<void>;
  /** The approvals waiting, oldest first; the panel shows the first. */
  readonly pendingApprovals: ReadonlyArray<PendingApproval>;
  readonly onRespondToApproval: (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<void>;
  readonly pendingUserInput: PendingUserInput | undefined;
  readonly onRespondToUserInput: (
    requestId: RuntimeRequestId,
    answers: ProviderUserInputAnswers,
  ) => Promise<void>;
}) {
  const { action } = props;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [modePickerOpen, setModePickerOpen] = useState(false);
  const onModePickerOpenChange = useCallback((open: boolean) => setModePickerOpen(open), []);

  // T3 Code's `composer.mode` keybinding, wherever focus is in the window.
  useEffect(() => {
    const open = (event: globalThis.KeyboardEvent) => {
      if (!isComposerModeShortcut(event, navigator.platform)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) setModePickerOpen(true);
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, []);

  const canSend =
    text.trim().length > 0 && action.kind === "send" && !sending && props.selection !== undefined;

  const interrupt = async (runId: Extract<ComposerAction, { kind: "interrupt" }>["runId"]) => {
    setInterrupting(true);
    setError(undefined);
    try {
      await props.onInterrupt(runId);
    } catch (cause) {
      setError(errorMessage(cause, "The run could not be interrupted."));
    } finally {
      setInterrupting(false);
    }
  };

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(undefined);
    try {
      await props.onSend(text);
      setText("");
    } catch (cause) {
      setError(errorMessage(cause, "The message could not be sent."));
    } finally {
      setSending(false);
    }
  };

  const selectModel = async (selection: ModelSelection) => {
    setError(undefined);
    try {
      await props.onSelectModel(selection);
    } catch (cause) {
      setError(errorMessage(cause, "The model could not be changed."));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-6">
      {props.pendingApprovals[0] !== undefined ? (
        <ComposerPendingApprovalPanel
          key={props.pendingApprovals[0].requestId}
          approval={props.pendingApprovals[0]}
          pendingCount={props.pendingApprovals.length}
          onRespond={props.onRespondToApproval}
        />
      ) : props.pendingUserInput === undefined ? null : (
        <ComposerPendingUserInputPanel
          key={props.pendingUserInput.requestId}
          pending={props.pendingUserInput}
          onRespond={props.onRespondToUserInput}
        />
      )}
      {error === undefined ? null : (
        <p role="alert" className="mb-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="rounded-2xl border border-neutral-200 bg-white p-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <textarea
          aria-label="Message"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask anything"
          className="w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-neutral-400"
        />
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-1">
            <ProviderModelPicker
              entries={props.entries}
              selection={props.selection}
              disabled={!canChooseModel(action) || sending}
              onSelect={(selection) => void selectModel(selection)}
            />
            {props.selection === undefined ? null : (
              <TraitsPicker
                provider={props.selection.instanceId}
                capabilities={
                  props.entries
                    .find((entry) => entry.instanceId === props.selection?.instanceId)
                    ?.models.find((model) => model.slug === props.selection?.model)?.capabilities
                }
                options={props.selection.options}
                prompt={text}
                onPromptChange={setText}
                onOptionsChange={props.onTraitsChange}
                disabled={!canChooseModel(action) || sending}
              />
            )}
            <span aria-hidden="true" className="h-4 w-px bg-neutral-200 dark:bg-neutral-800" />
            <RuntimeModePicker
              mode={props.runtimeMode}
              open={modePickerOpen}
              onOpenChange={onModePickerOpenChange}
              onSelect={props.onSelectRuntimeMode}
            />
          </div>
          {action.kind === "interrupt" ? (
            <InterruptButton disabled={interrupting} onClick={() => void interrupt(action.runId)} />
          ) : action.kind === "interrupting" ? (
            <span className="px-2 text-xs text-neutral-500 dark:text-neutral-400">
              Interrupting…
            </span>
          ) : (
            <button
              type="button"
              aria-label="Send message"
              disabled={!canSend}
              onClick={() => void send()}
              className="rounded-full bg-neutral-900 p-1.5 text-white disabled:opacity-30 dark:bg-neutral-100 dark:text-neutral-900"
            >
              <ArrowUpIcon className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** T3 Code's stop button: a filled square in a red circle, labelled **Interrupt**. */
function InterruptButton(props: { readonly disabled: boolean; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Interrupt"
      title="Interrupt"
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex size-7 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <rect x="2" y="2" width="8" height="8" rx="1.5" />
      </svg>
    </button>
  );
}

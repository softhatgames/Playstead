import {
  type ActiveTurnComposerAction,
  alternateComposerDispatchAction,
  type ComposerDispatchMode,
  resolveComposerDispatchMode,
} from "@playstead/client-runtime/state/composerDispatch";
import type { QueuedThreadRun } from "@playstead/client-runtime/state/threadWorkflows";
import type { RunId, RuntimeRequestId } from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  type ModelSelection,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderUserInputAnswers,
  type RuntimeMode,
} from "@playstead/contracts/orchestrationV2";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CornerUpRightIcon,
  ListPlusIcon,
  PlayIcon,
} from "../icons.tsx";
import { ComposerPlanFollowUpBanner, ComposerTasksBadge } from "./ComposerPlanBanners.tsx";
import { InteractionModeToggle } from "./InteractionModeToggle.tsx";
import {
  canChooseModel,
  type ComposerAction,
  deriveComposerAction,
  isComposerModeShortcut,
  isEditQueuedMessageShortcut,
  isSendAlternateShortcut,
  isSteerQueuedMessageShortcut,
  type ModelPickerEntry,
} from "./composer.logic.ts";
import { QueuedRunsControl, type QueuedRunsControlHandle } from "./QueuedRunsControl.tsx";
import { recoverQueuedMessageEdit } from "./queuedMessageEdit.ts";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel.tsx";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel.tsx";
import type { PendingApproval } from "./pendingApproval.logic.ts";
import type { PendingUserInput } from "./pendingUserInput.logic.ts";
import {
  type ActiveTasks,
  matchSlashCommands,
  parseStandaloneComposerSlashCommand,
} from "./plan.logic.ts";
import { ProviderModelPicker } from "./ProviderModelPicker.tsx";
import { RuntimeModePicker } from "./RuntimeModePicker.tsx";
import { TraitsPicker } from "./TraitsPicker.tsx";

const errorMessage = (cause: unknown, fallback: string) =>
  typeof cause === "object" && cause !== null && "message" in cause
    ? String(cause.message)
    : fallback;

/**
 * Whether Command (on a Mac) or Control is held now, for the send button's
 * Ctrl/⌘ alternative (T3 Code's `useShortcutModifierState`).
 */
function useModifierHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const update = (event: globalThis.KeyboardEvent) => setHeld(event.metaKey || event.ctrlKey);
    const release = () => setHeld(false);
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("blur", release);
    };
  }, []);
  return held;
}

/** The queued message open in the composer, and what the composer held before. */
interface QueuedEdit {
  readonly runId: RunId;
  readonly originalText: string;
  readonly threadText: string;
}

/**
 * The plain-text composer, after T3 Code's `ChatComposer.tsx` and
 * `ComposerPrimaryActions.tsx` at 2577baf without rich text, attachments,
 * chips or provider commands. Enter sends and Shift+Enter starts a new
 * line. While a run is active, an empty composer offers **Interrupt** (which
 * holds the queue, as T3 Code's Stop does), and once pressed says the run is
 * stopping; a message typed then is queued or steers the running turn, by
 * the thread's follow-up behaviour, and Mod+Enter or a Ctrl/⌘-click does the
 * other. The queued messages show above the composer; the pencil, or
 * `alt+arrowup` at the start of the composer, opens one for editing in the
 * composer, which keeps what was typed and gives it back afterwards; its
 * **Steer** button, or `mod+shift+enter` for the first, sends it into the
 * running turn instead. After
 * a stop, or while the queue is held, an empty composer offers **Resume**.
 * An approval the provider waits on shows above it, in the approval panel,
 * the oldest first; else a question, in the pending user-input panel (T3
 * Code's `ChatComposer` renders them there too, the approval first).
 * Beside the model picker are the reasoning and traits picker for the
 * selected model, which can rewrite the prompt for Ultrathink, and the mode
 * picker, which `mod+shift+a` opens; a mode chosen there goes with the next
 * message, even while a run is active.
 *
 * With **Plan mode (legacy)** on, the Plan/Build toggle sits after the mode
 * picker; Shift+Tab, `/plan` and `/default` (typed alone, or picked from
 * the slash menu) switch it too. A plan ready after a settled plan turn
 * shows the "Plan ready" banner: an empty composer offers **Implement**
 * and, in its menu, **Implement in a new thread**; text makes the button
 * **Refine**. The running turn's todo list shows as the task progress badge.
 */
export function ChatComposer(props: {
  readonly entries: ReadonlyArray<ModelPickerEntry>;
  readonly selection: ModelSelection | undefined;
  readonly onSelectModel: (selection: ModelSelection) => void | Promise<void>;
  /** The traits picker's new choices for the selected model. */
  readonly onTraitsChange: (options: ModelSelection["options"]) => void;
  readonly runtimeMode: RuntimeMode;
  readonly onSelectRuntimeMode: (mode: RuntimeMode) => void;
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  readonly turnItems: ReadonlyArray<OrchestrationV2TurnItem>;
  /** What Enter does while a run is active (the client setting). */
  readonly followUpBehavior: ActiveTurnComposerAction;
  readonly onSend: (text: string, dispatchMode: ComposerDispatchMode) => Promise<void>;
  readonly onInterrupt: (
    runId: Extract<ComposerAction, { kind: "interrupt" }>["runId"],
  ) => Promise<void>;
  /** Whether **Resume** has something to resume: a stopped run or a held queue. */
  readonly canResume: boolean;
  readonly onResume: () => Promise<void>;
  readonly queuedRuns: ReadonlyArray<QueuedThreadRun>;
  readonly onReorderQueuedRun: (runId: RunId, beforeRunId: RunId | null) => Promise<void>;
  readonly onRemoveQueuedRun: (runId: RunId) => Promise<void>;
  readonly onUpdateQueuedRun: (runId: RunId, text: string) => Promise<void>;
  /** Whether the active run's turn can take a queued message as a steer now. */
  readonly canPromoteToSteer: boolean;
  readonly onSteerQueuedRun: (runId: RunId) => Promise<void>;
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
  /** Plan or build, as the composer will send it. */
  readonly interactionMode: ProviderInteractionMode;
  /** Whether **Plan mode (legacy)** is on: the toggle, `/plan`, `/default` and Shift+Tab. */
  readonly interactionModeEnabled: boolean;
  readonly onInteractionModeChange: (mode: ProviderInteractionMode) => void;
  /**
   * A plan is ready: the banner shows, and an empty composer offers
   * **Implement** (sending nothing typed) and **Implement in a new thread**;
   * with text, the send button is **Refine**.
   */
  readonly planFollowUp: { readonly title: string | null } | undefined;
  readonly onImplementInNewThread: () => Promise<void>;
  /** The running turn's todo list, for the task progress badge. */
  readonly tasks: ActiveTasks | undefined;
}) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<QueuedEdit | null>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const queueRef = useRef<QueuedRunsControlHandle>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modifierHeld = useModifierHeld();
  const running = props.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status));
  const hasContent = text.trim().length > 0;
  const dispatchModeFor = (alternateModifier: boolean) =>
    resolveComposerDispatchMode({
      running,
      alternateModifier,
      activeTurnDefault: props.followUpBehavior,
    });
  const action = deriveComposerAction({
    runs: props.runs,
    turnItems: props.turnItems,
    hasContent,
    editingQueuedMessage: editing !== null,
    canResume: props.canResume,
    dispatchMode: dispatchModeFor(modifierHeld),
  });
  const alternate = alternateComposerDispatchAction(props.followUpBehavior);
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

  // T3 Code's `thread.steerQueuedMessage`: the first queued message steers the running turn.
  useEffect(() => {
    const steerNext = (event: globalThis.KeyboardEvent) => {
      if (!isSteerQueuedMessageShortcut(event, navigator.platform)) return;
      if (queueRef.current?.steerNext(event.repeat) !== true) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", steerNext);
    return () => window.removeEventListener("keydown", steerNext);
  }, []);

  const canSend =
    hasContent &&
    (action.kind === "send" ||
      action.kind === "queue" ||
      action.kind === "steer" ||
      action.kind === "update-queued") &&
    !sending &&
    props.selection !== undefined;

  // A queued message that starts or is removed while open here ends its
  // edit, as T3 Code's `recoverQueuedMessageEdit` decides.
  useEffect(() => {
    if (editing === null) return;
    if (props.queuedRuns.some(({ run }) => run.id === editing.runId)) return;
    const recovered = recoverQueuedMessageEdit({
      editText: text,
      originalText: editing.originalText,
      threadText: editing.threadText,
    });
    setText(recovered.text);
    setEditing(null);
    setNotice(
      recovered.outcome === "kept"
        ? "The queued message is no longer queued. Your unsaved edit was kept in the composer."
        : recovered.outcome === "discarded"
          ? "The queued message is no longer queued. Your unsaved edit was discarded."
          : undefined,
    );
  }, [editing, props.queuedRuns, text]);

  const beginEdit = (queued: QueuedThreadRun) => {
    setNotice(undefined);
    setEditing((current) => ({
      runId: queued.run.id,
      originalText: queued.text,
      // Editing another queued message keeps what was typed before the first.
      threadText: current?.threadText ?? text,
    }));
    setText(queued.text);
    textareaRef.current?.focus();
  };

  const cancelEdit = () => {
    if (editing === null) return;
    setText(editing.threadText);
    setEditing(null);
    textareaRef.current?.focus();
  };

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

  // T3 Code's slash commands: the menu while a slash and part of a name are
  // typed, and a message that is only `/plan` or `/default`.
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState<string | undefined>(undefined);
  const slashCommands =
    editing === null && slashDismissed !== text
      ? matchSlashCommands(text, props.interactionModeEnabled)
      : [];
  const chooseInteractionMode = (mode: ProviderInteractionMode) => {
    setText("");
    setSlashIndex(0);
    props.onInteractionModeChange(mode);
    textareaRef.current?.focus();
  };
  const toggleInteractionMode = () =>
    props.onInteractionModeChange(props.interactionMode === "plan" ? "default" : "plan");

  const [implementMenuOpen, setImplementMenuOpen] = useState(false);

  /** **Implement** sends nothing typed: the plan goes as the message. */
  const implement = async () => {
    setSending(true);
    setError(undefined);
    try {
      await props.onSend("", "auto");
    } catch (cause) {
      setError(errorMessage(cause, "Failed to send plan follow-up."));
    } finally {
      setSending(false);
    }
  };

  const implementInNewThread = async () => {
    setImplementMenuOpen(false);
    setSending(true);
    setError(undefined);
    try {
      await props.onImplementInNewThread();
    } catch (cause) {
      setError(errorMessage(cause, "Could not start implementation thread."));
    } finally {
      setSending(false);
    }
  };
  const send = async (alternateModifier: boolean) => {
    if (!canSend) return;
    if (editing === null && props.interactionModeEnabled) {
      const mode = parseStandaloneComposerSlashCommand(text);
      if (mode !== null) return chooseInteractionMode(mode);
    }
    setSending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      if (editing !== null) {
        await props.onUpdateQueuedRun(editing.runId, text.trim());
        setText(editing.threadText);
        setEditing(null);
        return;
      }
      await props.onSend(text, dispatchModeFor(alternateModifier));
      setText("");
    } catch (cause) {
      setError(
        errorMessage(
          cause,
          editing === null
            ? "The message could not be sent."
            : "Could not save the edited queued message.",
        ),
      );
    } finally {
      setSending(false);
    }
  };

  const resume = async () => {
    setSending(true);
    setError(undefined);
    try {
      await props.onResume();
    } catch (cause) {
      setError(errorMessage(cause, "Could not resume thread."));
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
    if (event.nativeEvent.isComposing) return;
    // The slash menu takes the arrows, Enter, Tab and Escape while it shows.
    if (slashCommands.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSlashIndex((at) => (at + step + slashCommands.length) % slashCommands.length);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        const picked = slashCommands[Math.min(slashIndex, slashCommands.length - 1)];
        if (picked !== undefined) chooseInteractionMode(picked.mode);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashDismissed(text);
        return;
      }
    }
    // T3 Code's hard-wired Shift+Tab: plan or build, with plan mode on.
    if (event.key === "Tab" && event.shiftKey && !event.metaKey && !event.ctrlKey) {
      if (!props.interactionModeEnabled) return;
      event.preventDefault();
      toggleInteractionMode();
      return;
    }
    // T3 Code's `thread.editQueuedMessage`, only with the caret at the start.
    if (isEditQueuedMessageShortcut(event)) {
      const atStart =
        event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0;
      if (atStart && queueRef.current?.editLatest(event.repeat) === true) event.preventDefault();
      return;
    }
    // T3 Code's `composer.sendAlternate`, while a turn runs.
    if (running && isSendAlternateShortcut(event, navigator.platform)) {
      event.preventDefault();
      void send(true);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      void send(false);
    }
  };

  const mac = /mac/i.test(navigator.platform);
  const followUpTooltip = `Click to ${props.followUpBehavior}, Ctrl/⌘-click or ${
    mac ? "⌘+Enter" : "Ctrl+Enter"
  } to ${alternate}`;

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
      <QueuedRunsControl
        ref={queueRef}
        queuedRuns={props.queuedRuns}
        editingRunId={editing?.runId ?? null}
        onEdit={beginEdit}
        onCancelEdit={cancelEdit}
        onReorder={props.onReorderQueuedRun}
        onRemove={props.onRemoveQueuedRun}
        hasActiveRun={running}
        canPromoteToSteer={props.canPromoteToSteer}
        onSteer={props.onSteerQueuedRun}
        steerShortcutLabel={mac ? "⌘+Shift+Enter" : "Ctrl+Shift+Enter"}
      />
      {props.tasks === undefined ? null : <ComposerTasksBadge tasks={props.tasks} />}
      {props.planFollowUp === undefined ? null : (
        <ComposerPlanFollowUpBanner planTitle={props.planFollowUp.title} />
      )}
      {notice === undefined ? null : (
        <p role="status" className="mb-2 text-xs text-neutral-600 dark:text-neutral-300">
          {notice}
        </p>
      )}
      {error === undefined ? null : (
        <p role="alert" className="mb-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="relative rounded-2xl border border-neutral-200 bg-white p-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {slashCommands.length === 0 ? null : (
          <div
            role="listbox"
            aria-label="Commands"
            className="absolute bottom-full left-0 z-10 mb-1 w-72 rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
          >
            {slashCommands.map((command, index) => (
              <button
                key={command.label}
                type="button"
                role="option"
                aria-selected={index === Math.min(slashIndex, slashCommands.length - 1)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseInteractionMode(command.mode)}
                className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left aria-selected:bg-neutral-100 dark:aria-selected:bg-neutral-800"
              >
                <span className="font-medium">{command.label}</span>
                <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {command.description}
                </span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
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
            {props.interactionModeEnabled ? (
              <InteractionModeToggle
                mode={props.interactionMode}
                onToggle={() => {
                  toggleInteractionMode();
                  textareaRef.current?.focus();
                }}
              />
            ) : null}
          </div>
          {action.kind === "interrupt" ? (
            <InterruptButton disabled={interrupting} onClick={() => void interrupt(action.runId)} />
          ) : action.kind === "interrupting" ? (
            <span className="px-2 text-xs text-neutral-500 dark:text-neutral-400">
              Interrupting…
            </span>
          ) : props.planFollowUp !== undefined && action.kind === "send" && !hasContent ? (
            <div className="relative flex items-center">
              <button
                type="button"
                disabled={sending || props.selection === undefined}
                onClick={() => void implement()}
                className="h-8 rounded-l-full bg-neutral-900 px-4 text-xs font-medium text-white disabled:opacity-30 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {sending ? "Sending..." : "Implement"}
              </button>
              <button
                type="button"
                aria-label="Implementation actions"
                aria-haspopup="menu"
                aria-expanded={implementMenuOpen}
                disabled={sending || props.selection === undefined}
                onClick={() => setImplementMenuOpen((open) => !open)}
                className="h-8 rounded-r-full border-l border-white/20 bg-neutral-900 px-2 text-white disabled:opacity-30 dark:border-neutral-900/20 dark:bg-neutral-100 dark:text-neutral-900"
              >
                <ChevronDownIcon className="size-3.5" />
              </button>
              {implementMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 bottom-full z-10 mb-1 w-52 rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void implementInNewThread()}
                    className="block w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    Implement in a new thread
                  </button>
                </div>
              ) : null}
            </div>
          ) : props.planFollowUp !== undefined && action.kind === "send" ? (
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void send(false)}
              className="h-8 rounded-full bg-neutral-900 px-4 text-xs font-medium text-white disabled:opacity-30 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {sending ? "Sending..." : "Refine"}
            </button>
          ) : action.kind === "resume" ? (
            <button
              type="button"
              aria-label="Resume thread"
              title="Resume thread"
              disabled={sending}
              onClick={() => void resume()}
              className="rounded-full bg-neutral-900 p-1.5 text-white disabled:opacity-30 dark:bg-neutral-100 dark:text-neutral-900"
            >
              <PlayIcon className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={
                action.kind === "update-queued"
                  ? "Update queued message"
                  : action.kind === "queue"
                    ? "Queue message"
                    : action.kind === "steer"
                      ? "Steer message"
                      : "Send message"
              }
              title={
                action.kind === "update-queued"
                  ? "Update queued message"
                  : running
                    ? followUpTooltip
                    : "Send message"
              }
              disabled={!canSend}
              onClick={(event: MouseEvent<HTMLButtonElement>) =>
                void send(event.metaKey || event.ctrlKey)
              }
              className="rounded-full bg-neutral-900 p-1.5 text-white disabled:opacity-30 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {action.kind === "update-queued" ? (
                <CheckIcon className="size-4" />
              ) : action.kind === "queue" ? (
                <ListPlusIcon className="size-4" />
              ) : action.kind === "steer" ? (
                <CornerUpRightIcon className="size-4" />
              ) : (
                <ArrowUpIcon className="size-4" />
              )}
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

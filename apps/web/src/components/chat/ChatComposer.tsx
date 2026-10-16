import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import { type KeyboardEvent, useState } from "react";

import { ArrowUpIcon } from "../icons.tsx";
import type { ModelPickerEntry } from "./composer.logic.ts";
import { ProviderModelPicker } from "./ProviderModelPicker.tsx";

const errorMessage = (cause: unknown, fallback: string) =>
  typeof cause === "object" && cause !== null && "message" in cause
    ? String(cause.message)
    : fallback;

/**
 * The plain-text composer, after T3 Code's `ChatComposer.tsx` and
 * `ComposerPrimaryActions.tsx` at 2577baf without rich text, attachments,
 * chips, commands, the queue or steering. Enter sends and Shift+Enter starts
 * a new line. While a run is active nothing can be sent; the interrupt is #24's.
 */
export function ChatComposer(props: {
  readonly entries: ReadonlyArray<ModelPickerEntry>;
  readonly selection: ModelSelection | undefined;
  readonly onSelectModel: (selection: ModelSelection) => void | Promise<void>;
  readonly working: boolean;
  readonly onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const canSend =
    text.trim().length > 0 && !props.working && !sending && props.selection !== undefined;

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
          <ProviderModelPicker
            entries={props.entries}
            selection={props.selection}
            onSelect={(selection) => void selectModel(selection)}
          />
          {props.working ? (
            <span className="px-2 text-xs text-neutral-500 dark:text-neutral-400">Working…</span>
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

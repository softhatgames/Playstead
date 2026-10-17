import type { RuntimeRequestId } from "@playstead/contracts/baseSchemas";
import type { ProviderUserInputAnswers } from "@playstead/contracts/orchestrationV2";
import { useState } from "react";

import {
  buildPendingUserInputAnswers,
  type PendingUserInput,
  type PendingUserInputDraftAnswer,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOption,
} from "./pendingUserInput.logic.ts";

const errorMessage = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "message" in cause
    ? String(cause.message)
    : "The answer could not be sent.";

/**
 * The provider's question above the composer, after T3 Code's
 * `ComposerPendingUserInputPanel.tsx` at 2577baf: each question with its
 * options to pick and a field for the person's own words, and **Send
 * answer** once every question has an answer. Every question shows at once
 * instead of one at a time; attachments and dismissing are absent. The turn
 * waiting on it can still be interrupted from the composer.
 */
export function ComposerPendingUserInputPanel(props: {
  readonly pending: PendingUserInput;
  readonly onRespond: (
    requestId: RuntimeRequestId,
    answers: ProviderUserInputAnswers,
  ) => Promise<void>;
}) {
  const { pending } = props;
  const [drafts, setDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const answers = buildPendingUserInputAnswers(pending.questions, drafts);

  const send = async () => {
    if (answers === null || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await props.onRespond(pending.requestId, answers);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      aria-label="Question from the agent"
      className="mb-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40"
    >
      {pending.questions.map((question) => {
        const draft = drafts[question.id];
        const picked = draft?.selectedOptionLabels ?? [];
        return (
          <fieldset key={question.id} className="mb-3 last:mb-2">
            <legend className="mb-1 text-xs font-medium tracking-wide text-amber-800 uppercase dark:text-amber-300">
              {question.header}
            </legend>
            <p className="mb-2">{question.question}</p>
            <div className="flex flex-wrap gap-2">
              {question.options.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={picked.includes(option.label)}
                  title={option.description.length > 0 ? option.description : undefined}
                  onClick={() =>
                    setDrafts((current) => ({
                      ...current,
                      [question.id]: togglePendingUserInputOption(
                        question,
                        current[question.id],
                        option.label,
                      ),
                    }))
                  }
                  className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs aria-pressed:border-neutral-900 aria-pressed:bg-neutral-900 aria-pressed:text-white dark:border-neutral-700 dark:bg-neutral-900 dark:aria-pressed:border-neutral-100 dark:aria-pressed:bg-neutral-100 dark:aria-pressed:text-neutral-900"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              aria-label={`Your own answer to: ${question.question}`}
              placeholder="Or type your own answer"
              value={draft?.customAnswer ?? ""}
              onChange={(event) => {
                const text = event.target.value;
                setDrafts((current) => ({
                  ...current,
                  [question.id]: setPendingUserInputCustomAnswer(current[question.id], text),
                }));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs outline-none dark:border-neutral-700 dark:bg-neutral-900"
            />
          </fieldset>
        );
      })}
      {error === undefined ? null : (
        <p role="alert" className="mb-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={answers === null || sending}
          onClick={() => void send()}
          className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-30 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {sending ? "Sending…" : "Send answer"}
        </button>
      </div>
    </section>
  );
}

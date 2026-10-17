import {
  type CustomSnoozeInput,
  localSnoozeDate,
  localSnoozeTime,
  resolveCustomSnooze,
} from "@playstead/client-runtime/state/threadSettled";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

/**
 * **Custom snooze** (T3 Code's `apps/web/src/components/CustomSnoozeDialog.tsx`
 * at 2577baf): a menu's **Custom…** asks for a local date and time, or a
 * duration, and gets the wake time, or null when the person cancels. Only
 * one request is open; a new one cancels the old.
 */

export interface SnoozeChoice {
  readonly snoozedUntil: string;
}

let pending: ((choice: SnoozeChoice | null) => void) | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

function finish(choice: SnoozeChoice | null): void {
  const resolve = pending;
  pending = null;
  notify();
  resolve?.(choice);
}

export function requestCustomSnooze(): Promise<SnoozeChoice | null> {
  finish(null);
  return new Promise((resolve) => {
    pending = resolve;
    notify();
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const isOpen = () => pending !== null;

/** Mounted once, beside the confirmation dialog. */
export function CustomSnoozeDialogHost() {
  const open = useSyncExternalStore(subscribe, isOpen, isOpen);
  useEffect(() => () => finish(null), []);
  return open ? <CustomSnoozeDialog /> : null;
}

const fieldClass =
  "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950";

function CustomSnoozeDialog() {
  const id = useId();
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [initial] = useState(() => new Date(Date.now() + 60 * 60 * 1000));
  const [mode, setMode] = useState<CustomSnoozeInput["mode"]>("date");
  const [date, setDate] = useState(() => localSnoozeDate(initial));
  const [time, setTime] = useState(() => localSnoozeTime(initial));
  const [amount, setAmount] = useState("2");
  const [unit, setUnit] = useState<"minutes" | "hours" | "days">("hours");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
  }, []);

  const input: CustomSnoozeInput = mode === "date" ? { mode, date, time } : { mode, amount, unit };
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setError(null);
    };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        finish(null);
      }}
      className="m-auto w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-xl backdrop:bg-black/40 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const snoozedUntil = resolveCustomSnooze(input, new Date());
          if (snoozedUntil === null) {
            setError(
              mode === "date"
                ? "Choose a valid date and time in the future."
                : "Enter a positive duration.",
            );
            return;
          }
          finish({ snoozedUntil });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h2 id={`${id}-title`} className="text-base font-semibold">
            Custom snooze
          </h2>
          <p id={`${id}-description`} className="text-sm text-neutral-600 dark:text-neutral-300">
            Choose when snoozed threads return to your inbox.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Schedule type"
          className="grid grid-cols-2 rounded-md border border-neutral-300 p-0.5 text-sm dark:border-neutral-700"
        >
          {(
            [
              ["date", "Date and time"],
              ["duration", "Duration"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => edit(setMode)(value)}
              className={`rounded px-2 py-1 ${
                mode === value
                  ? "bg-neutral-200 font-medium dark:bg-neutral-800"
                  : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "date" ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
              Date
              <input
                type="date"
                required
                min={localSnoozeDate(new Date())}
                value={date}
                onChange={(event) => edit(setDate)(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
              Time
              <input
                type="time"
                required
                value={time}
                onChange={(event) => edit(setTime)(event.target.value)}
                className={fieldClass}
              />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
              Snooze for
              <input
                type="number"
                required
                min={0}
                step="any"
                value={amount}
                onChange={(event) => edit(setAmount)(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
              Unit
              <select
                value={unit}
                onChange={(event) =>
                  edit(setUnit)(event.target.value as "minutes" | "hours" | "days")
                }
                className={fieldClass}
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </label>
          </div>
        )}
        {error === null ? null : (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => finish(null)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            Snooze
          </button>
        </div>
      </form>
    </dialog>
  );
}

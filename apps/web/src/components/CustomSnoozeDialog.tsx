import { useEffect, useRef, useState } from "react";
import { finishCustomSnooze, useCustomSnoozeRequest } from "../customSnooze.ts";
import {
  type CustomSnoozeInput,
  localSnoozeDate,
  localSnoozeTime,
  resolveCustomSnooze,
} from "./Sidebar.snooze.ts";

export function CustomSnoozeDialogHost() {
  const request = useCustomSnoozeRequest();
  useEffect(() => () => finishCustomSnooze(null), []);
  return request === null ? null : <CustomSnoozeDialog />;
}

/** Local date/time or elapsed duration, following T3 Code's CustomSnoozeDialog at 2577baf. */
function CustomSnoozeDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [initial] = useState(() => new Date(Date.now() + 3_600_000));
  const [mode, setMode] = useState<CustomSnoozeInput["mode"]>("date");
  const [date, setDate] = useState(localSnoozeDate(initial));
  const [time, setTime] = useState(localSnoozeTime(initial));
  const [amount, setAmount] = useState("2");
  const [unit, setUnit] = useState<"minutes" | "hours" | "days">("hours");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const inputClass =
    "w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 dark:border-neutral-700";
  return (
    <dialog
      ref={dialog}
      aria-labelledby="custom-snooze-title"
      onCancel={(event) => {
        event.preventDefault();
        finishCustomSnooze(null);
      }}
      className="m-auto w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-xl backdrop:bg-black/40 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const input: CustomSnoozeInput =
            mode === "date" ? { mode, date, time } : { mode, amount, unit };
          const wake = resolveCustomSnooze(input, new Date());
          if (wake === null) {
            setError(
              mode === "date"
                ? "Choose a valid date and time in the future."
                : "Enter a positive duration.",
            );
            return;
          }
          finishCustomSnooze(wake);
        }}
      >
        <h2 id="custom-snooze-title" className="font-semibold">
          Custom snooze
        </h2>
        <p className="text-sm text-neutral-500">
          Choose when snoozed threads return to your inbox.
        </p>
        <div className="flex gap-2" role="group" aria-label="Schedule type">
          {(["date", "duration"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                setError(null);
              }}
              className={`flex-1 rounded-md border px-2 py-1.5 text-sm ${mode === value ? "bg-neutral-200 dark:bg-neutral-700" : ""}`}
            >
              {value === "date" ? "Date and time" : "Duration"}
            </button>
          ))}
        </div>
        {mode === "date" ? (
          <div className="flex gap-3">
            <label className="min-w-0 flex-1 text-sm">
              Date
              <input
                autoFocus
                className={inputClass}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="min-w-0 flex-1 text-sm">
              Time
              <input
                className={inputClass}
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
          </div>
        ) : (
          <div className="flex gap-3">
            <label className="min-w-0 flex-1 text-sm">
              Amount
              <input
                autoFocus
                className={inputClass}
                type="number"
                step="any"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label className="min-w-0 flex-1 text-sm">
              Unit
              <select
                className={inputClass}
                value={unit}
                onChange={(event) => setUnit(event.target.value as typeof unit)}
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </label>
          </div>
        )}
        {error === null ? null : (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => finishCustomSnooze(null)}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Snooze
          </button>
        </div>
      </form>
    </dialog>
  );
}

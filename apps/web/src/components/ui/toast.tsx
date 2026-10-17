import { useSyncExternalStore } from "react";

/**
 * Short notices in the window's corner (T3 Code's `toastManager` and its
 * viewport in `apps/web/src/components/ui/toast.tsx` at 2577baf, trimmed to
 * what thread actions need: a failure with what went wrong, a warning, or
 * what was done). Each closes after a few seconds, or when dismissed.
 */

/** A button on the notice, such as **Delete anyway**; choosing it closes the notice. */
export interface ToastAction {
  readonly label: string;
  readonly destructive?: boolean;
  readonly onClick: () => void;
}

export interface Toast {
  readonly id: number;
  readonly type: "error" | "warning" | "success";
  readonly title: string;
  readonly description?: string;
  readonly action?: ToastAction;
}

const TOAST_DURATION_MS = 5_000;

let toasts: ReadonlyArray<Toast> = [];
let nextId = 1;
const listeners = new Set<() => void>();

const publish = (next: ReadonlyArray<Toast>) => {
  toasts = next;
  for (const listener of listeners) listener();
};

export const readToasts = (): ReadonlyArray<Toast> => toasts;

function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function dismissToast(id: number): void {
  publish(toasts.filter((toast) => toast.id !== id));
}

function addToast(toast: Omit<Toast, "id">): void {
  const id = nextId++;
  publish([...toasts, { ...toast, id }]);
  setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
}

/**
 * Something the person asked for that was not done, such as an empty title,
 * with what to do about it when there is something (T3 Code's "Project is
 * not empty" with **Delete anyway**).
 */
export function warningToast(
  title: string,
  options: { readonly description?: string; readonly action?: ToastAction } = {},
): void {
  addToast({ type: "warning", title, ...options });
}

/** Something done, and what it was, such as a copied path (T3 Code's success notices). */
export function successToast(title: string, description: string): void {
  addToast({ type: "success", title, description });
}

/** A failed action, with the error's message (T3 Code's `failureToast`). */
export function failureToast(title: string, error: unknown): void {
  addToast({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "An error occurred.",
  });
}

/** The window's notices, newest at the bottom (T3 Code's toast viewport, trimmed). */
export function ToastHost() {
  const toasts = useSyncExternalStore(subscribeToasts, readToasts, readToasts);
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[10001] flex w-80 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.type === "error" ? "alert" : "status"}
          className="pointer-events-auto flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="min-w-0 flex-1">
            <div
              className={`font-medium ${
                toast.type === "error"
                  ? "text-red-600 dark:text-red-400"
                  : toast.type === "warning"
                    ? "text-amber-600 dark:text-amber-400"
                    : ""
              }`}
            >
              {toast.title}
            </div>
            {toast.description === undefined ? null : (
              <div className="mt-0.5 text-neutral-600 dark:text-neutral-300">
                {toast.description}
              </div>
            )}
            {toast.action === undefined ? null : (
              <button
                type="button"
                onClick={() => {
                  dismissToast(toast.id);
                  toast.action?.onClick();
                }}
                className={`mt-2 rounded-md px-2.5 py-1 text-xs font-medium ${
                  toast.action.destructive === true
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                }`}
              >
                {toast.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(toast.id)}
            className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

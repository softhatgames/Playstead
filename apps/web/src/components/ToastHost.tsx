import { useSyncExternalStore } from "react";

import { dismissToast, readToasts, subscribeToasts } from "../toast.ts";

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
                onClick={toast.action.onClick}
                className="mt-2 rounded px-2 py-1 font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
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

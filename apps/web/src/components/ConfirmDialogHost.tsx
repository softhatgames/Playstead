import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  confirmDialogCopy,
  readConfirmDialogState,
  registerConfirmDialogHost,
  respondToConfirmDialog,
  subscribeConfirmDialog,
} from "../confirmDialog.ts";

/**
 * Shows the interface's confirmations as a modal dialog (T3 Code's
 * `apps/web/src/components/ConfirmDialogHost.tsx` at 2577baf): the question
 * as its title, the rest as its description, with **Cancel** and
 * **Confirm**, which is red for a destructive action. Escape cancels.
 */
export function ConfirmDialogHost() {
  const state = useSyncExternalStore(
    subscribeConfirmDialog,
    readConfirmDialogState,
    readConfirmDialogState,
  );
  const dialog = useRef<HTMLDialogElement | null>(null);

  useEffect(() => registerConfirmDialogHost(), []);
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (state.status === "confirming" && !element.open) element.showModal();
    if (state.status === "idle" && element.open) element.close();
  }, [state]);

  const copy = state.status === "confirming" ? confirmDialogCopy(state.message) : null;
  const destructive = state.status === "confirming" && state.variant === "destructive";
  return (
    <dialog
      ref={dialog}
      aria-labelledby="confirm-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        respondToConfirmDialog(false);
      }}
      className="m-auto w-full max-w-md rounded-xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-xl backdrop:bg-black/40 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
    >
      {copy === null ? null : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 id="confirm-dialog-title" className="text-base font-semibold">
              {copy.title}
            </h2>
            {copy.description === null ? null : (
              <p className="text-sm whitespace-pre-line text-neutral-600 dark:text-neutral-300">
                {copy.description}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => respondToConfirmDialog(false)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => respondToConfirmDialog(true)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${
                destructive
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-neutral-900 hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
              }`}
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

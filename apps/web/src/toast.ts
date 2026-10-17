/**
 * Short notices in the window's corner (T3 Code's `toastManager` in
 * `apps/web/src/components/ui/toast.tsx` at 2577baf, trimmed to what thread
 * actions need: a failure with what went wrong, a warning, or what was
 * done). Each closes after a few
 * seconds, or when dismissed.
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

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissToast(id: number): void {
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

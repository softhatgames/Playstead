/**
 * The interface's confirmations (T3 Code's `apps/web/src/confirmDialog.ts`
 * at 2577baf). A request waits for the dialog host to show it and for the
 * person's answer; requests made while one is showing wait their turn. In
 * T3 Code the desktop app uses this same themed dialog, not a native one.
 */

export type ConfirmDialogVariant = "default" | "destructive";

export interface ConfirmDialogOptions {
  readonly variant?: ConfirmDialogVariant;
}

export type ConfirmDialogState =
  | { readonly status: "idle" }
  | {
      readonly status: "confirming";
      readonly message: string;
      readonly variant: ConfirmDialogVariant;
    };

interface Pending {
  readonly message: string;
  readonly variant: ConfirmDialogVariant;
  readonly resolve: (confirmed: boolean) => void;
}

const idle: ConfirmDialogState = { status: "idle" };
let state: ConfirmDialogState = idle;
let active: Pending | null = null;
let queued: Array<Pending> = [];
let hosts = 0;
const listeners = new Set<() => void>();

const publish = (next: ConfirmDialogState) => {
  state = next;
  for (const listener of listeners) listener();
};

const showNext = () => {
  active = queued.shift() ?? null;
  publish(
    active === null
      ? idle
      : { status: "confirming", message: active.message, variant: active.variant },
  );
};

export const readConfirmDialogState = (): ConfirmDialogState => state;

export function subscribeConfirmDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A mounted host; when the last one goes, every waiting request is answered no. */
export function registerConfirmDialogHost(): () => void {
  hosts += 1;
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    hosts = Math.max(0, hosts - 1);
    if (hosts > 0) return;
    active?.resolve(false);
    for (const pending of queued) pending.resolve(false);
    active = null;
    queued = [];
    publish(idle);
  };
}

/** Asks the person; answers no when no host is mounted to ask with. */
export function requestConfirmDialog(
  message: string,
  options?: ConfirmDialogOptions,
): Promise<boolean> {
  if (hosts === 0) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    queued.push({ message, variant: options?.variant ?? "default", resolve });
    if (active === null) showNext();
  });
}

export function respondToConfirmDialog(confirmed: boolean): void {
  if (active === null) return;
  active.resolve(confirmed);
  showNext();
}

/**
 * The dialog's title and description from one message (T3 Code's
 * `resolveConfirmDialogCopy`): the line that asks the question is the title,
 * the other lines the description.
 */
export function confirmDialogCopy(message: string): {
  readonly title: string;
  readonly description: string | null;
} {
  const lines = message.trim().split("\n");
  const question = lines.findIndex((line) => line.trim().endsWith("?"));
  if (question >= 0) {
    const description = lines
      .filter((_, index) => index !== question)
      .join("\n")
      .trim();
    return { title: lines[question]!.trim(), description: description || null };
  }
  return {
    title: "Confirm action",
    description: message.trim() || "This action requires your confirmation.",
  };
}

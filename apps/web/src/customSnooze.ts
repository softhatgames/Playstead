import { useSyncExternalStore } from "react";

/** One custom-time request shared by header, sidebar and bulk menus. */
let pending: { readonly finish: (value: string | null) => void } | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export function requestCustomSnooze(): Promise<string | null> {
  finishCustomSnooze(null);
  return new Promise((finish) => {
    pending = { finish };
    notify();
  });
}
export function finishCustomSnooze(value: string | null): void {
  const request = pending;
  pending = null;
  request?.finish(value);
  notify();
}
export function useCustomSnoozeRequest() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => pending,
  );
}

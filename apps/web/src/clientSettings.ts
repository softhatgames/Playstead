import { type ClientSettings, DEFAULT_CLIENT_SETTINGS } from "@playstead/contracts/ipc";
import { useSyncExternalStore } from "react";

import { readLocalApi } from "./localApi.ts";

/**
 * The interface's client settings (T3 Code's `useClientSettings` and
 * `updateSettings` in `apps/web/src/hooks/useSettings.ts` at 2577baf). They
 * start at their defaults, load once from the desktop app or the browser's
 * storage, and are written back on every change.
 */

let current: ClientSettings = DEFAULT_CLIENT_SETTINGS;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();

const publish = (next: ClientSettings) => {
  current = next;
  for (const listener of listeners) listener();
};

const load = () => {
  loading ??= readLocalApi()
    .persistence.getClientSettings()
    .then((stored) => {
      if (stored !== null) publish(stored);
    })
    .catch(() => undefined);
  return loading;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  void load();
  return () => listeners.delete(listener);
};

/** The settings now, current with every change. */
export function useClientSettings(): ClientSettings {
  return useSyncExternalStore(subscribe, () => current);
}

/** The settings once loaded, for an action about to read one. */
export async function readClientSettings(): Promise<ClientSettings> {
  await load();
  return current;
}

/** Changes some settings and saves them all. */
export async function updateClientSettings(patch: Partial<ClientSettings>): Promise<void> {
  await load();
  const next = { ...current, ...patch };
  publish(next);
  await readLocalApi().persistence.setClientSettings(next);
}

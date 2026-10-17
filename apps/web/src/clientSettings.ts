import { type ClientSettings, DEFAULT_CLIENT_SETTINGS } from "@playstead/contracts/ipc";
import { useSyncExternalStore } from "react";

import {
  readBrowserClientSettings,
  writeBrowserClientSettings,
} from "./clientPersistenceStorage.ts";
import { desktopBridge } from "./env.ts";

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

const getStored = (): Promise<ClientSettings | null> =>
  desktopBridge === undefined
    ? Promise.resolve(readBrowserClientSettings())
    : desktopBridge.getClientSettings();

const setStored = (settings: ClientSettings): Promise<void> => {
  if (desktopBridge !== undefined) return desktopBridge.setClientSettings(settings);
  writeBrowserClientSettings(settings);
  return Promise.resolve();
};

const load = () => {
  loading ??= getStored()
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

/** Changes some settings and saves them all. */
export async function updateClientSettings(patch: Partial<ClientSettings>): Promise<void> {
  await load();
  const next = { ...current, ...patch };
  publish(next);
  await setStored(next);
}

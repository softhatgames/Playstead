import { ClientSettings } from "@playstead/contracts/ipc";
import { identity } from "@playstead/shared/identity";
import * as Schema from "effect/Schema";

/**
 * A browser's client settings in localStorage (T3 Code's
 * `apps/web/src/clientPersistenceStorage.ts` at 2577baf). Settings that
 * cannot be read count as none, so the defaults apply.
 */

const STORAGE_KEY = `${identity.urlScheme.production}:client-settings:v1`;
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(ClientSettings));
const encode = Schema.encodeSync(Schema.fromJsonString(ClientSettings));

export function readBrowserClientSettings(): ClientSettings | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : decode(raw);
  } catch {
    return null;
  }
}

export function writeBrowserClientSettings(settings: ClientSettings): void {
  window.localStorage.setItem(STORAGE_KEY, encode(settings));
}

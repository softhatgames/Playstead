import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderInstanceSettings,
} from "@playstead/contracts/providerInstance";
import type {
  ServerProviderAuth,
  ServerProviderModel,
  ServerProviderState,
} from "@playstead/contracts/server";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { ManagedServerProvider } from "./managedProvider.ts";

/**
 * What a driver's check finds, as T3 Code's `ProviderProbeResult` at 2577baf,
 * with the models T3 Code passes beside it. A check that couldn't tell
 * leaves out `auth` (unknown) and `models` (none).
 */
export interface ProviderProbeResult {
  readonly installed: boolean;
  readonly version: string | null;
  readonly status: ServerProviderState;
  readonly auth?: ServerProviderAuth;
  readonly models?: ReadonlyArray<ServerProviderModel>;
  readonly message?: string;
}

export interface ProviderDriverCreateInput {
  readonly instanceId: ProviderInstanceId;
  readonly settings: ProviderInstanceSettings;
  /** The server's environment, with T3 Code's known folders on PATH on Windows. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly cwd: string;
}

/**
 * One provider instance, built by its driver from its settings. Changing the
 * settings builds a new one. The orchestration adapter joins it with the
 * chat tickets.
 */
export interface ProviderInstance {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly snapshot: ManagedServerProvider;
}

/**
 * A provider kind, following T3 Code's `ProviderDriver`
 * (`packages/provider-core/src/server/driver.ts` at 2577baf). It has no
 * config schema of its own: **Binary path** is the only setting.
 */
export interface ProviderDriver<R = never> {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly create: (
    input: ProviderDriverCreateInput,
  ) => Effect.Effect<ProviderInstance, never, R | Scope.Scope>;
}

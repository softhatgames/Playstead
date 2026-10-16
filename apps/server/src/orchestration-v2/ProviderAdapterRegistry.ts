import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import type { ProviderAdapterV2 } from "@playstead/provider-core/server/ProviderAdapter";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";

/**
 * The adapter each provider instance runs threads through (T3 Code's
 * `apps/server/src/orchestration-v2/ProviderAdapterRegistry.ts` at 2577baf).
 * The server reads it from the provider registry, whose instances rebuild
 * their adapter when **Binary path** changes; tests give a replaying one.
 * An instance without an adapter cannot run threads: Codex until #22.
 */
export class ProviderAdapterRegistryV2 extends Context.Service<
  ProviderAdapterRegistryV2,
  {
    readonly get: (
      instanceId: ProviderInstanceId,
    ) => Effect.Effect<Option.Option<ProviderAdapterV2>>;
  }
>()("@playstead/server/orchestration-v2/ProviderAdapterRegistry/ProviderAdapterRegistryV2") {}

/** The server's: each instance's current adapter, from the provider registry. */
export const layerFromProviderRegistry = Layer.effect(
  ProviderAdapterRegistryV2,
  Effect.gen(function* () {
    const registry = yield* ProviderRegistry.ProviderRegistry;
    return ProviderAdapterRegistryV2.of({ get: registry.getAdapter });
  }),
);

/** A fixed set of adapters, as T3 Code's `layerFromDrivers` gives tests. */
export const layerFromAdapters = (adapters: ReadonlyArray<ProviderAdapterV2>) =>
  Layer.succeed(
    ProviderAdapterRegistryV2,
    ProviderAdapterRegistryV2.of({
      get: (instanceId) =>
        Effect.succeed(
          Option.fromUndefinedOr(adapters.find((adapter) => adapter.instanceId === instanceId)),
        ),
    }),
  );

import type { ServerProvider } from "@playstead/contracts/server";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

/**
 * An instance's status, kept current, following T3 Code's
 * `ManagedServerProvider` (`packages/provider-core/src/server/snapshot.ts`
 * and `managedProvider.ts` at 2577baf). It is checked once when the instance
 * is built and again on each refresh; there is no background interval.
 */
export interface ManagedServerProvider {
  readonly getSnapshot: Effect.Effect<ServerProvider>;
  /** Checks the provider again and returns what it found. */
  readonly refresh: Effect.Effect<ServerProvider>;
  /** The current status, then each change. */
  readonly streamChanges: Stream.Stream<ServerProvider>;
}

export const makeManagedServerProvider = Effect.fn("makeManagedServerProvider")(function* <
  R,
>(input: {
  /** Shown until the first check finishes. */
  readonly initialSnapshot: ServerProvider;
  readonly checkProvider: Effect.Effect<ServerProvider, never, R>;
}): Effect.fn.Return<ManagedServerProvider, never, R | Scope.Scope> {
  const context = yield* Effect.context<R>();
  const snapshot = yield* SubscriptionRef.make(input.initialSnapshot);
  // One check at a time: a refresh during a check waits, then checks again.
  const checks = yield* Semaphore.make(1);
  const refresh = input.checkProvider.pipe(
    Effect.tap((next) => SubscriptionRef.set(snapshot, next)),
    checks.withPermit,
    Effect.provideContext(context),
  );
  yield* Effect.forkScoped(refresh);
  return {
    getSnapshot: SubscriptionRef.get(snapshot),
    refresh,
    streamChanges: SubscriptionRef.changes(snapshot),
  };
});

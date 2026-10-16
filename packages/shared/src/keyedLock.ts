import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

/**
 * One lock per key, as T3 Code's `packages/shared/src/KeyedLock.ts` at
 * 2577baf gives: work under the same key runs one at a time, other keys run
 * freely, and a key's lock is dropped once nobody holds or waits for it.
 * Not reentrant: taking a key while holding it deadlocks.
 */
export interface KeyedLock<Key> {
  readonly withLock: <A, E, R>(key: Key, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

interface Entry {
  readonly semaphore: Semaphore.Semaphore;
  holders: number;
}

export const make = <Key>(): Effect.Effect<KeyedLock<Key>> =>
  Effect.sync(() => {
    const entries = new Map<Key, Entry>();

    const enter = (key: Key) =>
      Effect.sync(() => {
        let entry = entries.get(key);
        if (entry === undefined) {
          entry = { semaphore: Semaphore.makeUnsafe(1), holders: 0 };
          entries.set(key, entry);
        }
        entry.holders += 1;
        return entry;
      });

    const leave = (key: Key, entry: Entry) =>
      Effect.sync(() => {
        entry.holders -= 1;
        if (entry.holders === 0) entries.delete(key);
      });

    return {
      withLock: (key, effect) =>
        Effect.acquireUseRelease(
          enter(key),
          (entry) => entry.semaphore.withPermit(effect),
          (entry) => leave(key, entry),
        ),
    };
  });

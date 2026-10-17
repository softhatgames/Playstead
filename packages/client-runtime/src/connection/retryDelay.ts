import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";

/**
 * How long a client waits before trying the server again after `attempt`
 * failures: jittered within [cap/2, cap], where cap doubles from 2 s up to
 * 5 minutes.
 */
export const retryDelay = (attempt: number) =>
  Effect.gen(function* () {
    const cap = Math.min(300_000, 1000 * 2 ** (attempt + 1));
    return Duration.millis(yield* Random.nextIntBetween(Math.floor(cap / 2), cap));
  });

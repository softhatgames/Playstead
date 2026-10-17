import type { ServerLifecycleStreamEvent } from "@playstead/contracts/server";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

type LifecycleEventInput =
  | Omit<Extract<ServerLifecycleStreamEvent, { type: "welcome" }>, "sequence">
  | Omit<Extract<ServerLifecycleStreamEvent, { type: "ready" }>, "sequence">;

interface SnapshotState {
  readonly sequence: number;
  /** The latest event of each type. */
  readonly events: ReadonlyArray<ServerLifecycleStreamEvent>;
}

/** The environment's lifecycle: `welcome` once started, `ready` once commands run. */
export class ServerLifecycleEvents extends Context.Service<
  ServerLifecycleEvents,
  {
    readonly publish: (event: LifecycleEventInput) => Effect.Effect<ServerLifecycleStreamEvent>;
    /** The latest event of each type, then every later one. */
    readonly subscribe: Stream.Stream<ServerLifecycleStreamEvent>;
  }
>()("@playstead/server/serverLifecycleEvents") {}

const make = Effect.gen(function* () {
  const pubsub = yield* PubSub.unbounded<ServerLifecycleStreamEvent>();
  const state = yield* Ref.make<SnapshotState>({ sequence: 0, events: [] });

  return ServerLifecycleEvents.of({
    publish: (event) =>
      Ref.modify(state, (current) => {
        const next = { ...event, sequence: current.sequence + 1 } as ServerLifecycleStreamEvent;
        return [
          next,
          {
            sequence: next.sequence,
            events: [...current.events.filter((entry) => entry.type !== next.type), next],
          },
        ] as const;
      }).pipe(Effect.tap((event) => PubSub.publish(pubsub, event))),
    // Subscribe before reading the snapshot, so no event falls between them.
    subscribe: Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(pubsub);
        const snapshot = yield* Ref.get(state);
        return Stream.concat(
          Stream.fromIterable([...snapshot.events].sort((a, b) => a.sequence - b.sequence)),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((event) => event.sequence > snapshot.sequence),
          ),
        );
      }),
    ),
  });
});

export const layer = Layer.effect(ServerLifecycleEvents, make);

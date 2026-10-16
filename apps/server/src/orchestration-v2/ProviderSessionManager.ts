import type { ProviderSessionId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import type {
  ProviderAdapterV2,
  ProviderAdapterV2Error,
  ProviderAdapterV2RuntimePolicy,
  ProviderAdapterV2SessionRuntime,
} from "@playstead/provider-core/server/ProviderAdapter";
import * as KeyedLock from "@playstead/shared/keyedLock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

interface LiveSession {
  readonly adapter: ProviderAdapterV2;
  readonly session: ProviderAdapterV2SessionRuntime;
  readonly scope: Scope.Closeable;
}

/**
 * The provider sessions that are open, one per thread (T3 Code's
 * `apps/server/src/orchestration-v2/ProviderSessionManager.ts` at 2577baf,
 * trimmed to open and reuse). A thread's next turn reuses its live session;
 * a session whose provider process has gone, or that an adapter opened
 * before it was replaced because **Binary path** changed, is closed and
 * opened again. Sessions close with the server; a session opened for a
 * thread that has had turns, after a restart or a lost process, continues
 * the provider's own conversation (`initialNativeThreadId`).
 */
export class ProviderSessionManagerV2 extends Context.Service<
  ProviderSessionManagerV2,
  {
    readonly open: (input: {
      readonly threadId: ThreadId;
      readonly adapter: ProviderAdapterV2;
      readonly providerSessionId: ProviderSessionId;
      readonly modelSelection: ModelSelection;
      readonly runtimePolicy: ProviderAdapterV2RuntimePolicy;
      /** Passed to the adapter when a session is opened. */
      readonly initialNativeThreadId?: string;
    }) => Effect.Effect<
      { readonly session: ProviderAdapterV2SessionRuntime; readonly opened: boolean },
      ProviderAdapterV2Error
    >;
  }
>()("@playstead/server/orchestration-v2/ProviderSessionManager/ProviderSessionManagerV2") {}

const make = Effect.gen(function* () {
  const managerScope = yield* Effect.scope;
  const locks = yield* KeyedLock.make<ThreadId>();
  const live = new Map<ThreadId, LiveSession>();

  yield* Effect.addFinalizer(() => Effect.sync(() => live.clear()));

  return ProviderSessionManagerV2.of({
    open: (input) =>
      locks.withLock(
        input.threadId,
        Effect.gen(function* () {
          const current = live.get(input.threadId);
          if (
            current !== undefined &&
            current.adapter === input.adapter &&
            (yield* current.session.isLive)
          ) {
            return { session: current.session, opened: false };
          }
          if (current !== undefined) {
            live.delete(input.threadId);
            yield* Scope.close(current.scope, Exit.void);
          }
          const scope = yield* Scope.fork(managerScope);
          const session = yield* input.adapter
            .openSession({
              threadId: input.threadId,
              providerSessionId: input.providerSessionId,
              modelSelection: input.modelSelection,
              runtimePolicy: input.runtimePolicy,
              ...(input.initialNativeThreadId === undefined
                ? {}
                : { initialNativeThreadId: input.initialNativeThreadId }),
            })
            .pipe(
              Scope.provide(scope),
              Effect.onError(() => Scope.close(scope, Exit.void)),
            );
          live.set(input.threadId, { adapter: input.adapter, session, scope });
          return { session, opened: true };
        }),
      ),
  });
});

export const layer = Layer.effect(ProviderSessionManagerV2, make);

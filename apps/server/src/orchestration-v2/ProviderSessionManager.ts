import type { ProviderSessionId, ThreadId } from "@playstead/contracts/baseSchemas";
import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
} from "@playstead/contracts/orchestrationV2";
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
  /** The runtime and interaction modes the session opened with. */
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

/**
 * The provider sessions that are open, one per thread (T3 Code's
 * `apps/server/src/orchestration-v2/ProviderSessionManager.ts` at 2577baf,
 * trimmed to open and reuse). A thread's next turn reuses its live session;
 * a session whose provider process has gone, or that an adapter opened
 * before it was replaced because **Binary path** changed, is closed and
 * opened again. So is a session asked for another runtime or interaction
 * mode than it opened with, when its adapter cannot switch mode in session (T3 Code's
 * `restart_and_resume` in `ProviderSessionTransitionPolicy.ts`, reached
 * there by detaching the session when the mode is set). Sessions close
 * with the server; a session opened for a thread that has had turns, after
 * a restart, a lost process or a mode change, continues the provider's own
 * conversation (`initialNativeThreadId`). `detach` stops a thread's session
 * (T3 Code's `detach`), as archiving, deleting and settling a thread do;
 * the thread's next turn opens a new one.
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
    /**
     * Closes the thread's session if it is the one named. A session already
     * gone, or replaced since, is left alone, so a detach run again after a
     * restart does nothing.
     */
    readonly detach: (input: {
      readonly threadId: ThreadId;
      readonly providerSessionId: ProviderSessionId;
    }) => Effect.Effect<void>;
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
            ((current.runtimeMode === input.runtimePolicy.runtimeMode &&
              current.interactionMode === input.runtimePolicy.interactionMode) ||
              input.adapter.capabilities.sessions.supportsRuntimeModeSwitchInSession) &&
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
          live.set(input.threadId, {
            adapter: input.adapter,
            session,
            scope,
            runtimeMode: input.runtimePolicy.runtimeMode,
            interactionMode: input.runtimePolicy.interactionMode,
          });
          return { session, opened: true };
        }),
      ),
    detach: (input) =>
      locks.withLock(
        input.threadId,
        Effect.suspend(() => {
          const current = live.get(input.threadId);
          if (current?.session.providerSession.id !== input.providerSessionId) return Effect.void;
          live.delete(input.threadId);
          return Scope.close(current.scope, Exit.void);
        }),
      ),
  });
});

export const layer = Layer.effect(ProviderSessionManagerV2, make);

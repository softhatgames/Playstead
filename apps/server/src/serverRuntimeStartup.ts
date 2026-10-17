import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as EffectWorker from "./orchestration-v2/EffectWorker.ts";
import * as ProviderRuntimeRecovery from "./orchestration-v2/ProviderRuntimeRecoveryService.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";

export class ServerRuntimeStartupError extends Schema.TaggedError<ServerRuntimeStartupError>()(
  "ServerRuntimeStartupError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The server did not finish starting.";
  }
}

/**
 * Startup, and the gate it opens (T3 Code's `apps/server/src/serverRuntimeStartup.ts`
 * at 2577baf). Recovery settles what the last server left running, then the
 * effect worker starts. Until startup completes, every HTTP request waits at
 * the gate, so the environment descriptor answering means recovery is done
 * and the server is ready for commands.
 */
export class ServerRuntimeStartup extends Context.Service<
  ServerRuntimeStartup,
  {
    readonly isCommandReady: Effect.Effect<boolean>;
    readonly awaitCommandReady: Effect.Effect<void, ServerRuntimeStartupError>;
    readonly markHttpListening: Effect.Effect<void>;
  }
>()("@playstead/server/serverRuntimeStartup") {}

export interface StartupOptions {
  /**
   * Work that must finish before the server takes commands, after recovery;
   * tests use it to hold startup open.
   */
  readonly beforeReady?: Effect.Effect<void>;
}

const make = (options?: StartupOptions) =>
  Effect.gen(function* () {
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;
    const recovery = yield* ProviderRuntimeRecovery.ProviderRuntimeRecoveryService;
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;

    const commandReady = yield* Deferred.make<void, ServerRuntimeStartupError>();
    const httpListening = yield* Deferred.make<void>();
    const workerFiber = yield* Ref.make<Fiber.Fiber<void> | undefined>(undefined);

    // On the way out, as T3 Code's startup finalizer does: close the gate,
    // stop the effect worker, and settle what is still running while the
    // provider sessions and the database are still open.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Deferred.fail(
          commandReady,
          new ServerRuntimeStartupError({ cause: "The server is shutting down." }),
        );
        const fiber = yield* Ref.getAndSet(workerFiber, undefined);
        if (fiber !== undefined) yield* Fiber.interrupt(fiber);
        const settled = yield* recovery.reconcile("shutdown");
        yield* Effect.logDebug("Settled the work still running at shutdown").pipe(
          Effect.annotateLogs({ ...settled }),
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Settling the work still running at shutdown failed.").pipe(
            Effect.annotateLogs({ cause: Cause.pretty(cause) }),
          ),
        ),
      ),
    );

    // The effect worker starts only once recovery has settled what the last
    // server left, so it never picks up a turn that server had started.
    const startEffectWorker = Effect.gen(function* () {
      const fiber = yield* worker.runDaemon.pipe(
        Effect.catchCause((cause) =>
          Effect.logError("The orchestration effect worker stopped.").pipe(
            Effect.annotateLogs({ cause: Cause.pretty(cause) }),
          ),
        ),
        Effect.forkScoped,
      );
      yield* Ref.set(workerFiber, fiber);
    });

    const startup = Effect.gen(function* () {
      const descriptor = yield* environment.getDescriptor;
      const recovered = yield* recovery.recover;
      if (
        recovered.cancelledRuns > 0 ||
        recovered.cancelledEffects > 0 ||
        recovered.requeuedEffects > 0
      ) {
        yield* Effect.logInfo("Settled the work the last server left running").pipe(
          Effect.annotateLogs({ ...recovered }),
        );
      }
      yield* startEffectWorker;
      yield* options?.beforeReady ?? Effect.void;
      yield* Deferred.await(httpListening);
      yield* lifecycleEvents.publish({
        version: 1,
        type: "welcome",
        payload: { environment: descriptor },
      });
      yield* Deferred.succeed(commandReady, undefined);
      yield* Effect.logDebug("Accepting commands");
      yield* lifecycleEvents.publish({
        version: 1,
        type: "ready",
        payload: { at: yield* DateTime.now, environment: descriptor },
      });
    });

    yield* Effect.forkScoped(
      Effect.exit(startup).pipe(
        Effect.flatMap((exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : Effect.logError("Server startup failed", { cause: Cause.pretty(exit.cause) }).pipe(
                Effect.andThen(
                  Deferred.fail(commandReady, new ServerRuntimeStartupError({ cause: exit.cause })),
                ),
              ),
        ),
      ),
    );

    return ServerRuntimeStartup.of({
      isCommandReady: Deferred.isDone(commandReady),
      awaitCommandReady: Deferred.await(commandReady),
      markHttpListening: Deferred.succeed(httpListening, undefined).pipe(Effect.asVoid),
    });
  });

export const layerWithOptions = (options?: StartupOptions) =>
  Layer.effect(ServerRuntimeStartup, make(options));

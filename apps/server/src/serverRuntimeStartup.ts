import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
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
 * Startup, and the gate it opens. Until startup completes, every HTTP request
 * waits at the gate, so the environment descriptor answering means the server
 * is ready for commands.
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
   * Work that must finish before the server takes commands. Recovery joins it
   * when the server has runs to recover; tests use it to hold startup open.
   */
  readonly beforeReady?: Effect.Effect<void>;
}

const make = (options?: StartupOptions) =>
  Effect.gen(function* () {
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;

    const commandReady = yield* Deferred.make<void, ServerRuntimeStartupError>();
    const httpListening = yield* Deferred.make<void>();

    yield* Effect.addFinalizer(() =>
      Deferred.fail(
        commandReady,
        new ServerRuntimeStartupError({ cause: "The server is shutting down." }),
      ),
    );

    const startup = Effect.gen(function* () {
      const descriptor = yield* environment.getDescriptor;
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

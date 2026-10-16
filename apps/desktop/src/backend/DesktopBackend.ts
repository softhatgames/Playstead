import {
  type DesktopBackendBootstrap,
  DesktopBackendBootstrap as DesktopBackendBootstrapSchema,
} from "@playstead/contracts/desktopBootstrap";
import { identity } from "@playstead/shared/identity";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

import { BACKEND_HOST } from "./ports.ts";

/** The descriptor the server writes to; the server reads it from `PLAYSTEAD_BOOTSTRAP_FD`. */
const BOOTSTRAP_FD = 3;
const variable = (name: string) => `${identity.environmentVariablePrefix}${name}`;

export type BackendState =
  | { readonly _tag: "Starting"; readonly attempt: number }
  | { readonly _tag: "Ready"; readonly pid: number; readonly httpBaseUrl: string }
  | {
      readonly _tag: "Exited";
      readonly exitCode: number | undefined;
      readonly restartIn: Duration.Duration;
    };

export interface DesktopBackend {
  readonly httpBaseUrl: string;
  readonly state: SubscriptionRef.SubscriptionRef<BackendState>;
}

export interface DesktopBackendConfig {
  /** Electron's own binary in the app, Node in tests. */
  readonly executablePath: string;
  /** The built server, `apps/server/dist/bin.mjs`. */
  readonly entryPath: string;
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly bootstrap: DesktopBackendBootstrap;
  /** Where the server's own output goes: the app's terminal, or nowhere in tests. */
  readonly output?: "inherit" | "ignore";
}

/**
 * The server's environment. Its settings go on the private descriptor, so no
 * `PLAYSTEAD_*` variable of the app's is passed on, and Electron's binary runs
 * as Node, as in T3 Code's `DesktopBackendConfiguration.ts`.
 */
const createBackendEnv = (
  baseEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (name.toUpperCase().startsWith(identity.environmentVariablePrefix)) continue;
    env[name] = value;
  }
  env.ELECTRON_RUN_AS_NODE = "1";
  env[variable("BOOTSTRAP_FD")] = String(BOOTSTRAP_FD);
  return env;
};

/** T3 Code's `calculateRestartDelay`: 500 ms doubling up to 10 s. */
const restartDelay = (attempt: number) => Duration.millis(Math.min(500 * 2 ** attempt, 10_000));

const encodeBootstrap = Schema.encodeEffect(Schema.fromJsonString(DesktopBackendBootstrapSchema));

/**
 * Asks for the environment descriptor until it answers. The server holds
 * every request until startup and recovery complete, so an answer means it
 * takes commands.
 */
const awaitDescriptor = (httpBaseUrl: string) =>
  HttpClient.HttpClient.pipe(
    Effect.flatMap((client) =>
      client
        .get(`${httpBaseUrl}${identity.environmentDescriptorPath}`)
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.scoped,
          Effect.timeout("1 second"),
          Effect.retry(Schedule.spaced("100 millis")),
        ),
    ),
    Effect.asVoid,
  );

/**
 * The desktop app's server: started as a child process with its settings on
 * a private descriptor, ready once its descriptor answers, and started again
 * after it exits, until the scope closes. Follows T3 Code's
 * `apps/desktop/src/backend/DesktopBackendManager.ts`, with one server and no
 * pool.
 */
export const makeDesktopBackend = Effect.fn("makeDesktopBackend")(function* (
  config: DesktopBackendConfig,
): Effect.fn.Return<
  DesktopBackend,
  never,
  Scope.Scope | ChildProcessSpawner.ChildProcessSpawner | HttpClient.HttpClient
> {
  const httpBaseUrl = `http://${BACKEND_HOST}:${config.bootstrap.port}`;
  const state = yield* SubscriptionRef.make<BackendState>({ _tag: "Starting", attempt: 0 });
  const bootstrapLine = `${yield* Effect.orDie(encodeBootstrap(config.bootstrap))}\n`;
  const output = config.output ?? "inherit";

  /** One run of the server; whether it got ready. */
  const runOnce = (attempt: number) =>
    Effect.gen(function* () {
      yield* SubscriptionRef.set(state, { _tag: "Starting", attempt });
      const handle = yield* ChildProcess.make(config.executablePath, [config.entryPath], {
        env: createBackendEnv(config.baseEnv),
        extendEnv: false,
        stdin: "ignore",
        stdout: output,
        stderr: output,
        killSignal: "SIGTERM",
        forceKillAfter: "5 seconds",
        additionalFds: {
          [`fd${BOOTSTRAP_FD}`]: {
            type: "input",
            stream: Stream.encodeText(Stream.make(bootstrapLine)),
          },
        },
      });
      let ready = false;
      yield* awaitDescriptor(httpBaseUrl).pipe(
        Effect.andThen(() => {
          ready = true;
          return SubscriptionRef.set(state, { _tag: "Ready", pid: handle.pid, httpBaseUrl });
        }),
        Effect.forkScoped,
      );
      const exitCode = yield* handle.exitCode.pipe(
        Effect.option,
        Effect.map(Option.getOrUndefined),
      );
      return { ready, exitCode };
    }).pipe(Effect.scoped);

  yield* Effect.gen(function* () {
    let attempt = 0;
    for (;;) {
      const run = yield* runOnce(attempt).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("The server could not be started.", cause).pipe(
            Effect.as({ ready: false, exitCode: undefined }),
          ),
        ),
      );
      attempt = run.ready ? 0 : attempt + 1;
      const restartIn = restartDelay(attempt);
      yield* SubscriptionRef.set(state, { _tag: "Exited", exitCode: run.exitCode, restartIn });
      yield* Effect.logWarning("The server exited; starting it again.").pipe(
        Effect.annotateLogs({ exitCode: run.exitCode, restartIn: Duration.format(restartIn) }),
      );
      yield* Effect.sleep(restartIn);
    }
  }).pipe(Effect.forkScoped);

  return { httpBaseUrl, state };
});

export type ReadyBackendState = Extract<BackendState, { readonly _tag: "Ready" }>;

/** The backend's first ready state that `matches`, the current one included. */
export const awaitBackendReady = (
  backend: DesktopBackend,
  matches: (state: ReadyBackendState) => boolean = () => true,
): Effect.Effect<ReadyBackendState> =>
  SubscriptionRef.changes(backend.state).pipe(
    Stream.filter((state): state is ReadyBackendState => state._tag === "Ready" && matches(state)),
    Stream.runHead,
    Effect.flatMap((found) => (Option.isSome(found) ? Effect.succeed(found.value) : Effect.never)),
  );

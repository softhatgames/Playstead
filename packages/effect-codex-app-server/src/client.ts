import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import type { ChildProcessSpawner } from "effect/process";

import * as Rpc from "./_generated/meta.gen.ts";
import {
  type CodexAppServerError,
  CodexAppServerPayloadError,
  CodexAppServerProcessExitedError,
  CodexAppServerProtocolError,
  CodexAppServerRequestError,
} from "./errors.ts";

/**
 * Playstead's client for `codex app-server`: JSON-RPC, one message per line
 * over stdio, with every request, answer and notification encoded and decoded
 * through the schema generated from Codex's own (`_generated/`). Follows T3
 * Code's `packages/effect-codex-app-server/src/{client,protocol}.ts` at
 * 2577baf, without its logging hooks, raw streams, unknown-method handlers or
 * `turn/start` widening.
 *
 * It talks to an `Stdio` from Codex's side: `stdin` is what Codex writes,
 * `stdout` is where the client writes to Codex. A child process gives one
 * (`fromChildProcess`), and so does the replay driver.
 */

type TypeOf<S> = S extends Schema.Top ? S["Type"] : undefined;

export type RequestParams<M extends Rpc.ClientRequestMethod> = TypeOf<
  (typeof Rpc.CLIENT_REQUEST_PARAMS)[M]
>;
export type RequestResponse<M extends Rpc.ClientRequestMethod> = TypeOf<
  (typeof Rpc.CLIENT_REQUEST_RESPONSES)[M]
>;
export type NotificationParams<M extends Rpc.ClientNotificationMethod> = TypeOf<
  (typeof Rpc.CLIENT_NOTIFICATION_PARAMS)[M]
>;
export type ServerRequestParams<M extends Rpc.ServerRequestMethod> = TypeOf<
  (typeof Rpc.SERVER_REQUEST_PARAMS)[M]
>;
export type ServerRequestResponse<M extends Rpc.ServerRequestMethod> = TypeOf<
  (typeof Rpc.SERVER_REQUEST_RESPONSES)[M]
>;
export type ServerNotificationParams<M extends Rpc.ServerNotificationMethod> = TypeOf<
  (typeof Rpc.SERVER_NOTIFICATION_PARAMS)[M]
>;

export class CodexAppServerClient extends Context.Service<
  CodexAppServerClient,
  {
    readonly request: <M extends Rpc.ClientRequestMethod>(
      method: M,
      params: RequestParams<M>,
    ) => Effect.Effect<RequestResponse<M>, CodexAppServerError>;
    readonly notify: <M extends Rpc.ClientNotificationMethod>(
      method: M,
      params: NotificationParams<M>,
    ) => Effect.Effect<void, CodexAppServerError>;
    /** Answers Codex's requests for `method`. Codex gets "method not found" for a method nobody handles. */
    readonly handleServerRequest: <M extends Rpc.ServerRequestMethod>(
      method: M,
      handler: (
        params: ServerRequestParams<M>,
      ) => Effect.Effect<ServerRequestResponse<M>, CodexAppServerError>,
    ) => Effect.Effect<void>;
    /** Runs `handler` for each of Codex's `method` notifications, in the order they arrive. */
    readonly handleServerNotification: <M extends Rpc.ServerNotificationMethod>(
      method: M,
      handler: (params: ServerNotificationParams<M>) => Effect.Effect<void>,
    ) => Effect.Effect<void>;
    /**
     * Waits until Codex's output has ended, after every message before the
     * end was handled, and gives what requests now fail with.
     */
    readonly terminated: Effect.Effect<CodexAppServerError>;
  }
>()("@playstead/effect-codex-app-server/client/CodexAppServerClient") {}

type AnySchema = Schema.Codec<unknown, unknown> | undefined;

const decodePayload = (method: string, schema: AnySchema, payload: unknown) =>
  schema === undefined
    ? Effect.undefined
    : Schema.decodeUnknownEffect(schema)(payload).pipe(
        Effect.mapError(
          (error) =>
            new CodexAppServerPayloadError({ method, operation: "decode", issue: error.message }),
        ),
      );

const encodePayload = (method: string, schema: AnySchema, payload: unknown) =>
  schema === undefined
    ? Effect.undefined
    : Schema.encodeUnknownEffect(schema)(payload).pipe(
        Effect.mapError(
          (error) =>
            new CodexAppServerPayloadError({ method, operation: "encode", issue: error.message }),
        ),
      );

const JsonRpcError = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optionalKey(Schema.Unknown),
});
/** Any message Codex writes; which kind it is depends on which of `id`, `method`, `result` and `error` it has. */
const IncomingMessage = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String])),
    method: Schema.optionalKey(Schema.String),
    params: Schema.optionalKey(Schema.Unknown),
    result: Schema.optionalKey(Schema.Unknown),
    error: Schema.optionalKey(JsonRpcError),
  }),
);
const decodeIncoming = Schema.decodeUnknownEffect(IncomingMessage);
const encodeOutgoing = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const schemaFor = (table: Record<string, AnySchema>, method: string): AnySchema =>
  Object.hasOwn(table, method) ? table[method] : undefined;

type RequestHandler = (params: unknown) => Effect.Effect<unknown, CodexAppServerError>;
type NotificationHandler = (params: unknown) => Effect.Effect<void>;

export interface CodexAppServerClientOptions {
  /** What pending and later requests fail with once Codex's output ends. */
  readonly terminationError?: Effect.Effect<CodexAppServerError>;
}

/** A client over Codex's stdio. Closing the scope stops reading and writing. */
export const make = Effect.fn("CodexAppServerClient.make")(function* (
  stdio: Stdio.Stdio,
  options: CodexAppServerClientOptions = {},
): Effect.fn.Return<CodexAppServerClient["Service"], never, Scope.Scope> {
  const outgoing = yield* Queue.unbounded<string, Cause.Done<void>>();
  const pending = new Map<
    string,
    { readonly method: string; readonly deferred: Deferred.Deferred<unknown, CodexAppServerError> }
  >();
  const requestHandlers = new Map<string, RequestHandler>();
  const notificationHandlers = new Map<string, Array<NotificationHandler>>();
  const nextId = yield* Ref.make(1);
  const terminated = yield* Ref.make(Option.none<CodexAppServerError>());
  const ended = yield* Deferred.make<CodexAppServerError>();

  const send = (message: Record<string, unknown>) =>
    Effect.gen(function* () {
      const failure = yield* Ref.get(terminated);
      if (Option.isSome(failure)) return yield* failure.value;
      const line = yield* encodeOutgoing(message).pipe(
        Effect.mapError((error) => new CodexAppServerProtocolError({ detail: error.message })),
      );
      yield* Queue.offer(outgoing, `${line}\n`);
    });

  const terminate = (error: CodexAppServerError) =>
    Effect.gen(function* () {
      if (Option.isSome(yield* Ref.get(terminated))) return;
      yield* Ref.set(terminated, Option.some(error));
      for (const { deferred } of pending.values()) yield* Deferred.fail(deferred, error);
      pending.clear();
      yield* Queue.end(outgoing);
      yield* Deferred.succeed(ended, error);
    });

  const answerRequest = (id: string | number, method: string, params: unknown) => {
    const handler = requestHandlers.get(method);
    const answer: Effect.Effect<unknown, CodexAppServerError> =
      handler === undefined || !Object.hasOwn(Rpc.SERVER_REQUEST_PARAMS, method)
        ? Effect.fail(CodexAppServerRequestError.methodNotFound(method))
        : decodePayload(method, schemaFor(Rpc.SERVER_REQUEST_PARAMS, method), params).pipe(
            Effect.flatMap(handler),
            Effect.flatMap((result) =>
              encodePayload(method, schemaFor(Rpc.SERVER_REQUEST_RESPONSES, method), result),
            ),
          );
    return answer.pipe(
      Effect.matchEffect({
        onSuccess: (result) => send({ id, result }),
        onFailure: (error) =>
          send({
            id,
            error: (error._tag === "CodexAppServerRequestError"
              ? error
              : CodexAppServerRequestError.internal(method, error.message)
            ).toJsonRpc(),
          }),
      }),
      Effect.ignore,
    );
  };

  const dispatchNotification = (method: string, params: unknown) => {
    const handlers = notificationHandlers.get(method);
    if (handlers === undefined || !Object.hasOwn(Rpc.SERVER_NOTIFICATION_PARAMS, method)) {
      return Effect.void;
    }
    return decodePayload(method, schemaFor(Rpc.SERVER_NOTIFICATION_PARAMS, method), params).pipe(
      Effect.flatMap((decoded) =>
        Effect.forEach(handlers, (handler) => handler(decoded), { discard: true }),
      ),
      Effect.catch((error) =>
        Effect.logWarning("Ignored a Codex notification that doesn't match its schema", error),
      ),
    );
  };

  const settleResponse = (
    id: string | number,
    result: unknown,
    error: typeof JsonRpcError.Type | undefined,
  ) =>
    Effect.suspend(() => {
      const request = pending.get(String(id));
      if (request === undefined) return Effect.void;
      pending.delete(String(id));
      return error === undefined
        ? Deferred.succeed(request.deferred, result)
        : Deferred.fail(
            request.deferred,
            new CodexAppServerRequestError({
              method: request.method,
              code: error.code,
              detail: error.message,
              ...(error.data === undefined ? {} : { data: error.data }),
            }),
          );
    });

  const handleLine = (line: string) =>
    line.trim().length === 0
      ? Effect.void
      : decodeIncoming(line).pipe(
          Effect.mapError(
            () => new CodexAppServerProtocolError({ detail: `Not a JSON-RPC message: ${line}` }),
          ),
          Effect.flatMap((message) => {
            if (message.method !== undefined && message.id !== undefined) {
              // Answered in its own fiber, so a slow handler doesn't hold up Codex's output.
              return Effect.forkScoped(answerRequest(message.id, message.method, message.params));
            }
            if (message.method !== undefined) {
              return dispatchNotification(message.method, message.params);
            }
            if (message.id !== undefined) {
              return settleResponse(message.id, message.result, message.error);
            }
            return Effect.fail(
              new CodexAppServerProtocolError({ detail: `Not a JSON-RPC message: ${line}` }),
            );
          }),
        );

  const reader = yield* stdio.stdin.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach(handleLine),
    Effect.matchEffect({
      onFailure: (error) =>
        terminate(
          error._tag === "PlatformError"
            ? new CodexAppServerProtocolError({ detail: error.message })
            : error,
        ),
      onSuccess: () =>
        Effect.flatMap(
          options.terminationError ??
            Effect.succeed(new CodexAppServerProcessExitedError({ code: null, stderr: "" })),
          terminate,
        ),
    }),
    Effect.forkScoped,
  );
  yield* Stream.fromQueue(outgoing).pipe(
    Stream.run(stdio.stdout()),
    Effect.ignore,
    Effect.forkScoped,
  );
  yield* Effect.addFinalizer(() => Fiber.interrupt(reader));

  const request = <M extends Rpc.ClientRequestMethod>(method: M, params: RequestParams<M>) =>
    Effect.gen(function* () {
      const encoded = yield* encodePayload(
        method,
        schemaFor(Rpc.CLIENT_REQUEST_PARAMS, method),
        params,
      );
      const id = yield* Ref.getAndUpdate(nextId, (current) => current + 1);
      const deferred = yield* Deferred.make<unknown, CodexAppServerError>();
      pending.set(String(id), { method, deferred });
      yield* send({ id, method, ...(encoded === undefined ? {} : { params: encoded }) }).pipe(
        Effect.tapError(() => Effect.sync(() => pending.delete(String(id)))),
      );
      const result = yield* Deferred.await(deferred).pipe(
        Effect.onInterrupt(() => Effect.sync(() => pending.delete(String(id)))),
      );
      return (yield* decodePayload(
        method,
        schemaFor(Rpc.CLIENT_REQUEST_RESPONSES, method),
        result,
      )) as RequestResponse<M>;
    });

  const notify = <M extends Rpc.ClientNotificationMethod>(
    method: M,
    params: NotificationParams<M>,
  ) =>
    encodePayload(method, schemaFor(Rpc.CLIENT_NOTIFICATION_PARAMS, method), params).pipe(
      Effect.flatMap((encoded) =>
        send({ method, ...(encoded === undefined ? {} : { params: encoded }) }),
      ),
    );

  return CodexAppServerClient.of({
    request,
    notify,
    handleServerRequest: (method, handler) =>
      Effect.sync(() => {
        requestHandlers.set(method, handler as RequestHandler);
      }),
    handleServerNotification: (method, handler) =>
      Effect.sync(() => {
        notificationHandlers.set(method, [
          ...(notificationHandlers.get(method) ?? []),
          handler as NotificationHandler,
        ]);
      }),
    terminated: Deferred.await(ended),
  });
});

const STDERR_TAIL_LENGTH = 4096;
const encoder = new TextEncoder();

/**
 * A spawned `codex app-server`'s stdio, from Codex's side, with what requests
 * fail with once its output ends. Its error output is drained and the end of
 * it kept, so that requests fail with the exit code and what Codex said, as
 * T3 Code's `layerChildProcess` drains it. A recorder taps this stdio.
 */
export const childProcessStdio = Effect.fn("CodexAppServerClient.childProcessStdio")(function* (
  handle: ChildProcessSpawner.ChildProcessHandle,
) {
  const stderr = yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (tail, chunk) => (tail + chunk).slice(-STDERR_TAIL_LENGTH),
    ),
    Effect.orElseSucceed(() => ""),
    Effect.forkScoped,
  );
  const terminationError: Effect.Effect<CodexAppServerError> = Effect.gen(function* () {
    const code = yield* handle.exitCode.pipe(
      Effect.map(Number),
      Effect.orElseSucceed(() => null),
    );
    return new CodexAppServerProcessExitedError({ code, stderr: yield* Fiber.join(stderr) });
  });
  const stdio = Stdio.make({
    args: Effect.succeed([]),
    stdin: handle.stdout,
    stdout: () =>
      Sink.mapInput(handle.stdin, (chunk: string | Uint8Array) =>
        typeof chunk === "string" ? encoder.encode(chunk) : chunk,
      ),
    stderr: () => Sink.drain,
  });
  return { stdio, terminationError };
});

/** A client over a spawned `codex app-server`. */
export const fromChildProcess = Effect.fn("CodexAppServerClient.fromChildProcess")(function* (
  handle: ChildProcessSpawner.ChildProcessHandle,
) {
  const { stdio, terminationError } = yield* childProcessStdio(handle);
  return yield* make(stdio, { terminationError });
});

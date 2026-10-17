// @effect-diagnostics preferSchemaOverJson:off -- Frames are compared and shown as JSON text.
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";

import * as CodexClient from "./client.ts";
import {
  type CodexAppServerError,
  CodexAppServerProcessExitedError,
  CodexAppServerProtocolError,
} from "./errors.ts";

/**
 * Replays a recording of Codex's app-server in place of Codex's stdio, under
 * the real client. Follows T3 Code's
 * `packages/effect-codex-app-server/src/replay.ts` at 2577baf, with three
 * differences:
 *
 * - It fails when part of the recording goes unused: `assertComplete`, and
 *   closing the scope that made the driver after it succeeded. T3 Code's
 *   `CodexAppServerReplayIncompleteError` is never raised.
 * - Outbound frames are compared strictly. Only `initialize`'s
 *   `clientInfo.version`, which changes with each release, is ignored; T3 Code
 *   also drops Full access's `turn/start` policies and thread `cwd`/`model`.
 * - There is no `afterMs`: replays never wait on the clock.
 */

const ExpectOutbound = Schema.Struct({
  type: Schema.Literal("expect_outbound"),
  label: Schema.optionalKey(Schema.String),
  frame: Schema.Unknown,
});
const EmitInbound = Schema.Struct({
  type: Schema.Literal("emit_inbound"),
  label: Schema.optionalKey(Schema.String),
  frame: Schema.Unknown,
});
const RuntimeExit = Schema.Struct({
  type: Schema.Literal("runtime_exit"),
  status: Schema.Literals(["success", "error"]),
  error: Schema.optionalKey(Schema.Unknown),
});

const CodexAppServerReplayEntry = Schema.Union([ExpectOutbound, EmitInbound, RuntimeExit]);
export type CodexAppServerReplayEntry = typeof CodexAppServerReplayEntry.Type;
export type CodexAppServerReplayEmitInbound = typeof EmitInbound.Type;

/** A recording: the header (provider, protocol, Codex's version, scenario, capture date) and its entries. */
export const CodexAppServerReplayTranscript = Schema.Struct({
  provider: Schema.Literal("codex"),
  protocol: Schema.Literal("codex.app-server"),
  version: Schema.String,
  scenario: Schema.String,
  capturedAt: Schema.String,
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  entries: Schema.Array(CodexAppServerReplayEntry),
});
export type CodexAppServerReplayTranscript = typeof CodexAppServerReplayTranscript.Type;

class CodexAppServerReplayFrameMismatchError extends Schema.TaggedError<CodexAppServerReplayFrameMismatchError>()(
  "CodexAppServerReplayFrameMismatchError",
  {
    scenario: Schema.String,
    cursor: Schema.Number,
    label: Schema.optionalKey(Schema.String),
    expected: Schema.Unknown,
    actual: Schema.Unknown,
  },
) {
  override get message(): string {
    return `Outbound Codex frame did not match the recording at entry ${this.cursor} of ${this.scenario}${this.label === undefined ? "" : ` (${this.label})`}. Expected ${JSON.stringify(this.expected)}, sent ${JSON.stringify(this.actual)}.`;
  }
}

/** The client sent a frame where the recording has none left, or has Codex speak or exit. */
class CodexAppServerReplayUnexpectedOutboundError extends Schema.TaggedError<CodexAppServerReplayUnexpectedOutboundError>()(
  "CodexAppServerReplayUnexpectedOutboundError",
  { scenario: Schema.String, cursor: Schema.Number, actual: Schema.Unknown },
) {
  override get message(): string {
    return `Outbound Codex frame at entry ${this.cursor} of ${this.scenario}, where the recording expects none: ${JSON.stringify(this.actual)}.`;
  }
}

class CodexAppServerReplayRuntimeExitError extends Schema.TaggedError<CodexAppServerReplayRuntimeExitError>()(
  "CodexAppServerReplayRuntimeExitError",
  { scenario: Schema.String, cursor: Schema.Number, error: Schema.optionalKey(Schema.Unknown) },
) {
  override get message(): string {
    return `The recording of ${this.scenario} has Codex exit with an error at entry ${this.cursor}.`;
  }
}

class CodexAppServerReplayIncompleteError extends Schema.TaggedError<CodexAppServerReplayIncompleteError>()(
  "CodexAppServerReplayIncompleteError",
  {
    scenario: Schema.String,
    cursor: Schema.Number,
    remaining: Schema.Number,
    next: Schema.Unknown,
  },
) {
  override get message(): string {
    return `The recording of ${this.scenario} ended with ${this.remaining} unused entries, from entry ${this.cursor}: ${JSON.stringify(this.next)}.`;
  }
}

export type CodexAppServerReplayError =
  | CodexAppServerReplayFrameMismatchError
  | CodexAppServerReplayUnexpectedOutboundError
  | CodexAppServerReplayRuntimeExitError
  | CodexAppServerReplayIncompleteError;

export interface CodexAppServerReplayDriver {
  readonly transcript: CodexAppServerReplayTranscript;
  /** Codex's side of stdio, for `CodexClient.make`. One client per driver. */
  readonly stdio: Stdio.Stdio;
  /** What the client's requests fail with once the replayed output ends. */
  readonly terminationError: Effect.Effect<CodexAppServerError>;
  /** Fails if the replay went wrong, or if any entry but a trailing clean exit is unused. */
  readonly assertComplete: Effect.Effect<void, CodexAppServerReplayError>;
}

export interface CodexAppServerReplayOptions {
  /** Runs before each inbound frame is emitted, so a test can hold the replay at a point. */
  readonly beforeEmitInbound?: (entry: CodexAppServerReplayEmitInbound) => Effect.Effect<void>;
}

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

/** `initialize`'s `clientInfo.version` is Playstead's version, which a recording can't keep up with. */
const comparable = (frame: unknown): string => {
  if (typeof frame !== "object" || frame === null) return stableStringify(frame);
  const record = frame as Record<string, unknown>;
  const params = record.params as Record<string, unknown> | undefined;
  const clientInfo = params?.clientInfo;
  if (record.method !== "initialize" || typeof clientInfo !== "object" || clientInfo === null) {
    return stableStringify(frame);
  }
  return stableStringify({
    ...record,
    params: { ...params, clientInfo: { ...clientInfo, version: null } },
  });
};

const decodeFrame = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encoder = new TextEncoder();

/**
 * A driver for one recording. Closing the scope that made it, after that
 * scope succeeded and if nothing called `assertComplete`, dies with
 * `assertComplete`'s error, so a replay test can't pass on a recording it
 * didn't use.
 */
export const makeReplayDriver = Effect.fn("CodexAppServerReplay.makeReplayDriver")(function* (
  transcript: CodexAppServerReplayTranscript,
  options: CodexAppServerReplayOptions = {},
): Effect.fn.Return<CodexAppServerReplayDriver, never, Scope.Scope> {
  const { entries, scenario } = transcript;
  const inbound = yield* Queue.unbounded<Uint8Array, Cause.Done<void>>();
  let cursor = 0;
  let failure: CodexAppServerReplayError | undefined;

  const fail = (error: CodexAppServerReplayError) =>
    Effect.suspend(() => {
      failure ??= error;
      return Queue.end(inbound);
    });

  /** Emits Codex's frames up to the next one the client should send. */
  const emitInbound: Effect.Effect<void> = Effect.suspend(() => {
    const entry = entries[cursor];
    if (failure !== undefined || entry === undefined || entry.type === "expect_outbound") {
      return Effect.void;
    }
    cursor += 1;
    if (entry.type === "runtime_exit") {
      return entry.status === "success"
        ? Queue.end(inbound)
        : fail(
            new CodexAppServerReplayRuntimeExitError({
              scenario,
              cursor: cursor - 1,
              ...(entry.error === undefined ? {} : { error: entry.error }),
            }),
          );
    }
    return (options.beforeEmitInbound?.(entry) ?? Effect.void).pipe(
      Effect.andThen(Queue.offer(inbound, encoder.encode(`${JSON.stringify(entry.frame)}\n`))),
      Effect.andThen(emitInbound),
    );
  });

  const receiveOutbound = (line: string) =>
    Effect.gen(function* () {
      if (line.trim().length === 0 || failure !== undefined) return;
      const actual = yield* decodeFrame(line).pipe(Effect.orElseSucceed(() => line));
      const entry = entries[cursor];
      if (entry === undefined || entry.type !== "expect_outbound") {
        return yield* fail(
          new CodexAppServerReplayUnexpectedOutboundError({ scenario, cursor, actual }),
        );
      }
      if (comparable(entry.frame) !== comparable(actual)) {
        return yield* fail(
          new CodexAppServerReplayFrameMismatchError({
            scenario,
            cursor,
            ...(entry.label === undefined ? {} : { label: entry.label }),
            expected: entry.frame,
            actual,
          }),
        );
      }
      cursor += 1;
      yield* emitInbound;
    });

  const outbound = yield* Queue.unbounded<string, Cause.Done<void>>();
  yield* Stream.fromQueue(outbound).pipe(
    Stream.splitLines,
    Stream.runForEach(receiveOutbound),
    Effect.forkScoped,
  );
  const decoder = new TextDecoder();

  let checked = false;
  const assertComplete = Effect.suspend(() => {
    checked = true;
    if (failure !== undefined) return Effect.fail(failure);
    const last = entries.at(-1);
    const end =
      last?.type === "runtime_exit" && last.status === "success"
        ? entries.length - 1
        : entries.length;
    return cursor >= end
      ? Effect.void
      : Effect.fail(
          new CodexAppServerReplayIncompleteError({
            scenario,
            cursor,
            remaining: end - cursor,
            next: entries[cursor],
          }),
        );
  });

  yield* Effect.addFinalizer((exit) =>
    Exit.isSuccess(exit) && !checked ? Effect.orDie(assertComplete) : Effect.void,
  );
  yield* emitInbound;

  return {
    transcript,
    stdio: Stdio.make({
      args: Effect.succeed([]),
      stdin: Stream.fromQueue(inbound),
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) =>
          Queue.offer(
            outbound,
            typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }),
          ),
        ),
      stderr: () => Sink.drain,
    }),
    terminationError: Effect.sync(() =>
      failure === undefined
        ? new CodexAppServerProcessExitedError({ code: 0, stderr: "" })
        : new CodexAppServerProtocolError({ detail: failure.message }),
    ),
    assertComplete,
  };
});

/** The real client over a driver's stdio. */
export const makeReplayClient = (driver: CodexAppServerReplayDriver) =>
  CodexClient.make(driver.stdio, { terminationError: driver.terminationError });

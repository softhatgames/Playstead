import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  ProviderReplayEntry,
  ProviderReplayTranscript,
} from "@playstead/provider-testing/replayTranscript";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  ClaudeAgentSdkQueryRunner,
  ClaudeAgentSdkQueryRunnerError,
  recordedQueryOptions,
} from "./ClaudeAdapterV2.ts";

/**
 * Claude's query runner from a recording, and the recorder's wrapper around
 * the real one (T3 Code's `ClaudeAdapterV2.testkit.ts` at 2577baf,
 * `makeReplayQueryRunner` and `recordClaudeAgentSdkReplayTranscript`).
 *
 * A recording is the frames the adapter sent (`query.open` with the options
 * it decides, then each `query.set_model`, `prompt.offer` and
 * `query.interrupt`) and every message Claude Code sent back, in order. A
 * replay compares each frame the adapter sends with the next recorded one,
 * strictly, and plays Claude's messages up to the next frame it expects.
 * A prompt's uuid is new each run, so the replay pairs the recorded uuid
 * with the one sent and puts it in Claude's messages, as T3 Code's replay
 * remaps prompt uuids. `assertComplete` fails unless the whole recording was
 * used and every frame matched.
 */

export const CLAUDE_REPLAY_PROVIDER = "claudeAgent";
export const CLAUDE_REPLAY_PROTOCOL = "claude-agent-sdk.query";

export class ClaudeReplayError extends Schema.TaggedError<ClaudeReplayError>()(
  "ClaudeReplayError",
  {
    scenario: Schema.String,
    cursor: Schema.Number,
    detail: Schema.String,
    expected: Schema.optionalKey(Schema.Unknown),
    actual: Schema.optionalKey(Schema.Unknown),
  },
) {
  override get message(): string {
    const frames =
      this.expected === undefined && this.actual === undefined
        ? ""
        : `\nexpected: ${stableStringify(this.expected)}\nactual:   ${stableStringify(this.actual)}`;
    return `Claude replay "${this.scenario}" at entry ${this.cursor}: ${this.detail}${frames}`;
  }
}

/** JSON with sorted keys and without undefined fields, so equal frames compare equal. */
const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
        )
      : item,
  ) ?? "undefined";

const sameFrame = (left: unknown, right: unknown) =>
  stableStringify(JSON.parse(stableStringify(left))) ===
  stableStringify(JSON.parse(stableStringify(right)));

export interface ClaudeReplay {
  readonly runner: ClaudeAgentSdkQueryRunner["Service"];
  readonly assertComplete: Effect.Effect<void, ClaudeReplayError>;
  /** Waits until the replay reaches the message it holds back. */
  readonly awaitHeld: Effect.Effect<void>;
}

export interface ClaudeReplayOptions {
  /**
   * Claude's first message this matches is never sent, as if the server
   * stopped while Claude was still working (T3 Code's `ProviderReplayGate`).
   */
  readonly holdBefore?: (frame: unknown) => boolean;
}

export const makeClaudeReplay = Effect.fn("makeClaudeReplay")(function* (
  transcript: ProviderReplayTranscript,
  options: ClaudeReplayOptions = {},
) {
  const scenario = transcript.header.scenario;
  const entries = transcript.entries;
  const held = yield* Deferred.make<void>();
  const cursor = yield* Ref.make(0);
  const failure = yield* Ref.make<ClaudeReplayError | undefined>(undefined);
  const advanced = yield* Queue.sliding<void>(1);

  // Recorded prompt uuid -> the uuid the adapter sent in its place.
  const promptUuids = new Map<string, string>();
  const promptUuidOf = (frame: unknown): string | undefined => {
    if (typeof frame !== "object" || frame === null) return undefined;
    if (Reflect.get(frame, "type") !== "prompt.offer") return undefined;
    const uuid: unknown = Reflect.get(Reflect.get(frame, "message") ?? {}, "uuid");
    return typeof uuid === "string" ? uuid : undefined;
  };
  const withPromptUuids = (value: unknown): unknown => {
    if (typeof value === "string") return promptUuids.get(value) ?? value;
    if (Array.isArray(value)) return value.map(withPromptUuids);
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, withPromptUuids(item)]),
      );
    }
    return value;
  };

  const fail = (error: ClaudeReplayError) =>
    Effect.andThen(
      Ref.update(failure, (first) => first ?? error),
      Effect.andThen(Queue.offer(advanced, undefined), Effect.fail(error)),
    );

  const expectOutbound = (actual: unknown) =>
    Effect.gen(function* () {
      const first = yield* Ref.get(failure);
      if (first !== undefined) return yield* first;
      const at = yield* Ref.get(cursor);
      const entry = entries[at];
      if (entry === undefined) {
        return yield* fail(
          new ClaudeReplayError({
            scenario,
            cursor: at,
            detail: "The recording has ended.",
            actual,
          }),
        );
      }
      if (entry.type !== "expect_outbound") {
        return yield* fail(
          new ClaudeReplayError({
            scenario,
            cursor: at,
            detail: "The adapter sent a frame while Claude still had messages to send.",
            actual,
          }),
        );
      }
      const recordedUuid = promptUuidOf(entry.frame);
      const sentUuid = promptUuidOf(actual);
      if (recordedUuid !== undefined && sentUuid !== undefined) {
        promptUuids.set(recordedUuid, sentUuid);
      }
      if (!sameFrame(withPromptUuids(entry.frame), actual)) {
        return yield* fail(
          new ClaudeReplayError({
            scenario,
            cursor: at,
            detail: "The adapter sent a different frame.",
            expected: entry.frame,
            actual,
          }),
        );
      }
      yield* Ref.set(cursor, at + 1);
      yield* Queue.offer(advanced, undefined);
    });

  // Claude's next message, waiting while the recording expects a frame from
  // the adapter first. The stream ends with the recording.
  const nextInbound: Effect.Effect<SDKMessage | undefined, ClaudeReplayError> = Effect.gen(
    function* () {
      while (true) {
        const first = yield* Ref.get(failure);
        if (first !== undefined) return yield* first;
        const at = yield* Ref.get(cursor);
        const entry = entries[at];
        if (entry === undefined) return undefined;
        if (entry.type === "emit_inbound") {
          if (options.holdBefore?.(entry.frame) === true) {
            yield* Deferred.succeed(held, undefined);
            return yield* Effect.never;
          }
          yield* Ref.set(cursor, at + 1);
          return withPromptUuids(entry.frame) as SDKMessage;
        }
        yield* Queue.take(advanced);
      }
    },
  );

  const runner = ClaudeAgentSdkQueryRunner.of({
    allocateSessionId: Effect.succeed(String(transcript.header.metadata?.["nativeSessionId"])),
    open: (input) =>
      Effect.gen(function* () {
        yield* expectOutbound({ type: "query.open", options: recordedQueryOptions(input.options) });
        const asRunnerError = (cause: ClaudeReplayError) =>
          new ClaudeAgentSdkQueryRunnerError({ method: "replay", cause });
        return {
          messages: Stream.unfold(undefined, () =>
            Effect.map(nextInbound, (message) =>
              message === undefined ? undefined : ([message, undefined] as const),
            ),
          ).pipe(Stream.mapError(asRunnerError)),
          offer: (message: SDKUserMessage) =>
            expectOutbound({ type: "prompt.offer", message }).pipe(Effect.mapError(asRunnerError)),
          setModel: (model: string) =>
            expectOutbound({ type: "query.set_model", model }).pipe(Effect.mapError(asRunnerError)),
          interrupt: expectOutbound({ type: "query.interrupt" }).pipe(
            Effect.mapError(asRunnerError),
          ),
        };
      }).pipe(
        Effect.mapError((cause) => new ClaudeAgentSdkQueryRunnerError({ method: "replay", cause })),
      ),
  });

  const assertComplete = Effect.gen(function* () {
    const first = yield* Ref.get(failure);
    if (first !== undefined) return yield* first;
    const at = yield* Ref.get(cursor);
    if (at < entries.length) {
      return yield* new ClaudeReplayError({
        scenario,
        cursor: at,
        detail: `${entries.length - at} recorded entr${entries.length - at === 1 ? "y was" : "ies were"} never used.`,
        expected: entries[at]?.frame,
      });
    }
  });

  return { runner, assertComplete, awaitHeld: Deferred.await(held) } satisfies ClaudeReplay;
});

/** A copy that holds plain JSON, as the recording will. */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

/**
 * The real runner, with every frame the adapter sends and every message
 * Claude Code answers kept in order for a recording. The recorder cleans
 * them before writing.
 */
export const makeRecordingQueryRunner = (inner: ClaudeAgentSdkQueryRunner["Service"]) => {
  const entries: Array<ProviderReplayEntry> = [];
  const sessionIds: Array<string> = [];
  const runner = ClaudeAgentSdkQueryRunner.of({
    allocateSessionId: Effect.tap(inner.allocateSessionId, (id) =>
      Effect.sync(() => sessionIds.push(id)),
    ),
    open: (input) =>
      Effect.gen(function* () {
        entries.push({
          type: "expect_outbound",
          frame: asJson({ type: "query.open", options: recordedQueryOptions(input.options) }),
        });
        const session = yield* inner.open(input);
        return {
          messages: session.messages.pipe(
            Stream.tap((message) =>
              Effect.sync(() => entries.push({ type: "emit_inbound", frame: asJson(message) })),
            ),
          ),
          offer: (message: SDKUserMessage) =>
            Effect.andThen(
              Effect.sync(() =>
                entries.push({
                  type: "expect_outbound",
                  frame: asJson({ type: "prompt.offer", message }),
                }),
              ),
              session.offer(message),
            ),
          setModel: (model: string) =>
            Effect.andThen(
              Effect.sync(() =>
                entries.push({
                  type: "expect_outbound",
                  frame: { type: "query.set_model", model },
                }),
              ),
              session.setModel(model),
            ),
          interrupt: Effect.andThen(
            Effect.sync(() =>
              entries.push({ type: "expect_outbound", frame: { type: "query.interrupt" } }),
            ),
            session.interrupt,
          ),
        };
      }),
  });
  return { runner, entries, sessionIds };
};

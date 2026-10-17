import type { CanUseTool, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
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
 * it decides, then each `query.set_model`, `query.apply_flag_settings`,
 * `query.set_permission_mode`, `prompt.offer` and `query.interrupt`) and every message Claude Code sent back, in order. A
 * replay compares each frame the adapter sends with the next recorded one,
 * strictly, and plays Claude's messages up to the next frame it expects.
 * Claude Code's calls to the adapter's `canUseTool` are recorded as
 * `permission.request` (inbound, where the call came, with what Claude Code
 * said about the call) and what the adapter
 * answered as `permission.response`, as T3 Code's replay keeps them; the
 * replay calls the adapter's real callback and compares its answer with
 * the response recorded for the same tool use, wherever it lies, since an
 * interrupt makes its place a race. An interrupt aborts the callbacks still
 * waiting, as Claude Code does.
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

  // Recorded `permission.response` entries the adapter answered ahead of their place.
  const consumed = new Set<number>();
  const skipConsumed = Effect.flatMap(Ref.get(cursor), (at) => {
    let next = at;
    while (consumed.has(next)) next += 1;
    return next === at ? Effect.void : Ref.set(cursor, next);
  });
  // How the open query asks the adapter about a tool, and the asks still waiting.
  let askAdapter: ((frame: PermissionRequestFrame) => Effect.Effect<void>) | undefined;
  const waitingAsks = new Set<AbortController>();

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
      yield* skipConsumed;
      const at = yield* Ref.get(cursor);
      const ahead = permissionResponseAt(actual, at);
      if (ahead !== undefined && ahead !== at) {
        if (!sameFrame(entries[ahead]?.frame, actual)) {
          return yield* fail(
            new ClaudeReplayError({
              scenario,
              cursor: ahead,
              detail: "The adapter answered a tool request differently.",
              expected: entries[ahead]?.frame,
              actual,
            }),
          );
        }
        consumed.add(ahead);
        yield* Queue.offer(advanced, undefined);
        return;
      }
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

  /** Where the recorded answer to this tool request is, if `actual` is one. */
  function permissionResponseAt(actual: unknown, from: number): number | undefined {
    if (!isFrame(actual, "permission.response")) return undefined;
    const toolUseId = Reflect.get(actual, "toolUseID");
    for (let at = from; at < entries.length; at += 1) {
      const entry = entries[at]!;
      if (
        !consumed.has(at) &&
        entry.type === "expect_outbound" &&
        isFrame(entry.frame, "permission.response") &&
        Reflect.get(entry.frame, "toolUseID") === toolUseId
      ) {
        return at;
      }
    }
    return undefined;
  }

  // Claude's next message, waiting while the recording expects a frame from
  // the adapter first. The stream ends with the recording.
  const nextInbound: Effect.Effect<SDKMessage | undefined, ClaudeReplayError> = Effect.gen(
    function* () {
      while (true) {
        const first = yield* Ref.get(failure);
        if (first !== undefined) return yield* first;
        yield* skipConsumed;
        const at = yield* Ref.get(cursor);
        const entry = entries[at];
        if (entry === undefined) return undefined;
        if (entry.type === "emit_inbound" && isFrame(entry.frame, "permission.request")) {
          yield* Ref.set(cursor, at + 1);
          if (askAdapter === undefined) {
            return yield* fail(
              new ClaudeReplayError({
                scenario,
                cursor: at,
                detail: "Claude asked about a tool before a query was open.",
              }),
            );
          }
          yield* askAdapter(entry.frame as PermissionRequestFrame);
          continue;
        }
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
        const scope = yield* Effect.scope;
        const canUseTool = input.options.canUseTool;
        // Asks the adapter's own callback in the background, as Claude Code
        // does, and checks its answer once it gives one.
        askAdapter = (frame) => {
          const controller = new AbortController();
          waitingAsks.add(controller);
          return Effect.tryPromise({
            try: () =>
              canUseTool === undefined
                ? Promise.reject(new Error("The adapter passed no canUseTool."))
                : canUseTool(frame.toolName, frame.input, {
                    ...frame.options,
                    signal: controller.signal,
                    toolUseID: frame.toolUseID,
                    requestId: frame.requestId,
                  }),
            catch: (cause) =>
              new ClaudeReplayError({
                scenario,
                cursor: -1,
                detail: `The adapter's canUseTool failed: ${String(cause)}`,
              }),
          }).pipe(
            Effect.ensuring(Effect.sync(() => waitingAsks.delete(controller))),
            Effect.flatMap((result) =>
              expectOutbound(
                JSON.parse(
                  JSON.stringify({
                    type: "permission.response",
                    toolUseID: frame.toolUseID,
                    result,
                  }),
                ),
              ),
            ),
            Effect.catch(fail),
            Effect.ignore,
            Effect.forkIn(scope),
            Effect.asVoid,
          );
        };
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
          applyFlagSettings: (settings: unknown) =>
            expectOutbound({ type: "query.apply_flag_settings", settings }).pipe(
              Effect.mapError(asRunnerError),
            ),
          setPermissionMode: (mode: string) =>
            expectOutbound({ type: "query.set_permission_mode", mode }).pipe(
              Effect.mapError(asRunnerError),
            ),
          interrupt: expectOutbound({ type: "query.interrupt" }).pipe(
            Effect.andThen(
              Effect.sync(() => {
                for (const controller of waitingAsks) controller.abort();
              }),
            ),
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
    yield* skipConsumed;
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

/**
 * What Claude Code tells `canUseTool` about the call besides its ids, which
 * the adapter reads for an approval's prompt and session rules.
 */
const PERMISSION_REQUEST_OPTIONS = [
  "title",
  "displayName",
  "description",
  "decisionReason",
  "blockedPath",
  "suggestions",
] as const;
type PermissionRequestOptions = Partial<
  Pick<Parameters<CanUseTool>[2], (typeof PERMISSION_REQUEST_OPTIONS)[number]>
>;

/** Claude Code asking the adapter's `canUseTool` about a tool, as a recording keeps it. */
interface PermissionRequestFrame {
  readonly type: "permission.request";
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly toolUseID: string;
  readonly requestId: string;
  /** Absent from recordings made before approvals. */
  readonly options?: PermissionRequestOptions;
}

const permissionRequestOptions = (
  options: Parameters<CanUseTool>[2],
): PermissionRequestOptions | undefined => {
  const kept = Object.fromEntries(
    PERMISSION_REQUEST_OPTIONS.flatMap((key) =>
      options[key] === undefined ? [] : [[key, options[key]]],
    ),
  );
  return Object.keys(kept).length === 0 ? undefined : kept;
};

const isFrame = (frame: unknown, type: string): frame is object =>
  typeof frame === "object" && frame !== null && Reflect.get(frame, "type") === type;

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
        const canUseTool = input.options.canUseTool;
        const recordedCanUseTool: CanUseTool | undefined =
          canUseTool === undefined
            ? undefined
            : async (toolName, toolInput, callbackOptions) => {
                entries.push({
                  type: "emit_inbound",
                  frame: asJson({
                    type: "permission.request",
                    toolName,
                    input: toolInput,
                    toolUseID: callbackOptions.toolUseID,
                    requestId: callbackOptions.requestId,
                    options: permissionRequestOptions(callbackOptions),
                  }),
                });
                const result = await canUseTool(toolName, toolInput, callbackOptions);
                entries.push({
                  type: "expect_outbound",
                  frame: asJson({
                    type: "permission.response",
                    toolUseID: callbackOptions.toolUseID,
                    result,
                  }),
                });
                return result;
              };
        const session = yield* inner.open(
          recordedCanUseTool === undefined
            ? input
            : { ...input, options: { ...input.options, canUseTool: recordedCanUseTool } },
        );
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
          applyFlagSettings: (settings: Parameters<typeof session.applyFlagSettings>[0]) =>
            Effect.andThen(
              Effect.sync(() =>
                entries.push({
                  type: "expect_outbound",
                  frame: asJson({ type: "query.apply_flag_settings", settings }),
                }),
              ),
              session.applyFlagSettings(settings),
            ),
          setPermissionMode: (mode: Parameters<typeof session.setPermissionMode>[0]) =>
            Effect.andThen(
              Effect.sync(() =>
                entries.push({
                  type: "expect_outbound",
                  frame: { type: "query.set_permission_mode", mode },
                }),
              ),
              session.setPermissionMode(mode),
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

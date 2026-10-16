import {
  type Options as ClaudeQueryOptions,
  query,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { MessageId, NodeId, type ThreadId, TurnItemId } from "@playstead/contracts/baseSchemas";
import type {
  ModelSelection,
  OrchestrationV2ExecutionNode,
  OrchestrationV2ProviderFailure,
  OrchestrationV2TurnItem,
  RuntimeMode,
} from "@playstead/contracts/orchestrationV2";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import {
  type ProviderAdapterV2,
  ProviderAdapterV2Error,
  type ProviderAdapterV2Event,
  type ProviderAdapterV2SessionRuntime,
  type ProviderAdapterV2TurnInput,
} from "@playstead/provider-core/server/ProviderAdapter";
import type { ProcessEnvironment } from "@playstead/shared/shell";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { resolveClaudeSdkExecutablePath } from "../../provider/Drivers/ClaudeExecutable.ts";

/**
 * Claude through the Claude Agent SDK's `query()`, following T3 Code's
 * `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` at 2577baf,
 * trimmed to starting turns in Full access.
 *
 * - One `query()` per session, fed messages through a streaming prompt; a
 *   thread's next turn offers its message to the same query.
 * - Assistant text streams from the SDK's partial messages. T3 Code asks for
 *   them too but shows text only when each whole message arrives.
 * - A file write is a `file_change` item carrying the file's name and the
 *   content the Write tool was given, which T3 Code's item leaves out.
 *
 * - A turn whose model differs from the query's changes it first with the
 *   SDK's `setModel`, as T3 Code does when the selection can change live.
 *
 * Absent until their tickets: `canUseTool` and `AskUserQuestion` (#25),
 * interrupt (#24), resuming a session (#26); and, as in
 * the slice as a whole, thinking, MCP, subagents, attachments and usage.
 */

export type ClaudeAgentSdkQueryOptions = ClaudeQueryOptions;

export class ClaudeAgentSdkQueryRunnerError extends Schema.TaggedError<ClaudeAgentSdkQueryRunnerError>()(
  "ClaudeAgentSdkQueryRunnerError",
  { method: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    const detail = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Claude Agent SDK ${this.method} failed: ${detail}`;
  }
}

export interface ClaudeAgentSdkQueryOpenInput {
  readonly options: ClaudeAgentSdkQueryOptions;
  readonly threadId: ThreadId;
}

export interface ClaudeAgentSdkQuerySession {
  /** Claude Code's messages until the query ends. */
  readonly messages: Stream.Stream<SDKMessage, ClaudeAgentSdkQueryRunnerError>;
  readonly offer: (message: SDKUserMessage) => Effect.Effect<void, ClaudeAgentSdkQueryRunnerError>;
  /** Changes the model for the query's next turns. */
  readonly setModel: (model: string) => Effect.Effect<void, ClaudeAgentSdkQueryRunnerError>;
}

/**
 * The seam between the adapter and the SDK (T3 Code's
 * `ClaudeAgentSdkQueryRunner`). Production runs the real `query()`; Seam 1
 * tests replay a recording through it, and the recorder wraps the real one.
 */
export class ClaudeAgentSdkQueryRunner extends Context.Service<
  ClaudeAgentSdkQueryRunner,
  {
    readonly allocateSessionId: Effect.Effect<string, ClaudeAgentSdkQueryRunnerError>;
    /** The query closes when the scope does. */
    readonly open: (
      input: ClaudeAgentSdkQueryOpenInput,
    ) => Effect.Effect<ClaudeAgentSdkQuerySession, ClaudeAgentSdkQueryRunnerError, Scope.Scope>;
  }
>()("@playstead/server/orchestration-v2/Adapters/ClaudeAdapterV2/ClaudeAgentSdkQueryRunner") {}

const runnerError = (method: string) => (cause: unknown) =>
  new ClaudeAgentSdkQueryRunnerError({ method, cause });

/** The real `query()`, fed by a queue the adapter offers messages to. */
export const layerQueryRunner: Layer.Layer<ClaudeAgentSdkQueryRunner, never, Crypto.Crypto> =
  Layer.effect(
    ClaudeAgentSdkQueryRunner,
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      return ClaudeAgentSdkQueryRunner.of({
        allocateSessionId: crypto
          .randomUUIDv4()
          .pipe(Effect.mapError(runnerError("allocateSessionId"))),
        open: (input) =>
          Effect.gen(function* () {
            const prompts = yield* Queue.unbounded<SDKUserMessage>();
            const queryRuntime = yield* Effect.acquireRelease(
              Effect.try({
                try: () =>
                  query({
                    prompt: Stream.toAsyncIterable(Stream.fromQueue(prompts)),
                    options: input.options,
                  }),
                catch: runnerError("query"),
              }),
              (running) =>
                Effect.andThen(
                  Queue.shutdown(prompts),
                  Effect.sync(() => running.close()),
                ),
            );
            return {
              // Iterate the query itself, as T3 Code's `claudeQueryMessages`
              // does: its raw generator's return never settles while Claude
              // Code is idle, which would hang closing the session.
              messages: Stream.fromAsyncIterable(
                { [Symbol.asyncIterator]: () => queryRuntime },
                runnerError("messages"),
              ),
              offer: (message) => Queue.offer(prompts, message).pipe(Effect.asVoid),
              setModel: (model) =>
                Effect.tryPromise({
                  try: () => queryRuntime.setModel(model),
                  catch: runnerError("setModel"),
                }),
            };
          }),
      });
    }),
  );

/** Full access is the SDK's `bypassPermissions`, as T3 Code's `permissionModeForClaudeRuntimePolicy` maps it. */
const permissionModeForRuntimeMode = (runtimeMode: RuntimeMode) => {
  switch (runtimeMode) {
    case "full-access":
      return {
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      } as const;
  }
};

/**
 * The options a session's query opens with (T3 Code's `makeClaudeQueryOptions`):
 * Claude Code's own tools and system prompt, partial messages, the session id
 * the thread will keep (or resumes), and the person's `claude` with the server's
 * environment, in the project's folder.
 */
const makeClaudeQueryOptions = (input: {
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly nativeSessionId: string;
  /** Continue the session Claude Code saved under that id, instead of starting it. */
  readonly resume: boolean;
  readonly cwd: string;
  readonly executablePath: string;
  readonly environment: ProcessEnvironment;
}): ClaudeAgentSdkQueryOptions => ({
  model: input.modelSelection.model,
  tools: { type: "preset", preset: "claude_code" },
  ...permissionModeForRuntimeMode(input.runtimeMode),
  includePartialMessages: true,
  ...(input.resume ? { resume: input.nativeSessionId } : { sessionId: input.nativeSessionId }),
  systemPrompt: { type: "preset", preset: "claude_code" },
  cwd: input.cwd,
  additionalDirectories: [input.cwd],
  pathToClaudeCodeExecutable: input.executablePath,
  env: { ...input.environment },
});

/**
 * The options a recording keeps and a replay compares: everything the
 * adapter decides, without the executable, the environment or callbacks.
 */
export const recordedQueryOptions = (options: ClaudeAgentSdkQueryOptions) => ({
  model: options.model,
  tools: options.tools,
  permissionMode: options.permissionMode,
  allowDangerouslySkipPermissions: options.allowDangerouslySkipPermissions,
  includePartialMessages: options.includePartialMessages,
  sessionId: options.sessionId,
  resume: options.resume,
  systemPrompt: options.systemPrompt,
  cwd: options.cwd,
  additionalDirectories: options.additionalDirectories,
});

/** A plain-text message from the person, as T3 Code's `makeClaudeUserMessage` builds one. */
const makeClaudeUserMessage = (text: string): SDKUserMessage => ({
  type: "user",
  message: { role: "user", content: text },
  parent_tool_use_id: null,
});

type ClaudeToolItemType = "file_change" | "command_execution" | "dynamic_tool";

/** T3 Code's `CLAUDE_KNOWN_TOOL_CLASSIFICATIONS`: writes and edits are file changes, Bash runs commands, and every other tool is a dynamic tool. */
const classifyClaudeTool = (toolName: string): ClaudeToolItemType => {
  switch (toolName.toLowerCase()) {
    case "write":
    case "edit":
    case "multiedit":
    case "notebookedit":
      return "file_change";
    case "bash":
      return "command_execution";
    default:
      return "dynamic_tool";
  }
};

const stringField = (input: unknown, ...keys: ReadonlyArray<string>) => {
  if (typeof input !== "object" || input === null) return undefined;
  for (const key of keys) {
    const value: unknown = Reflect.get(input, key);
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
};

type ContentBlock = SDKAssistantMessage["message"]["content"][number];

const toolResultText = (content: unknown): string | undefined => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const texts = content.flatMap((part: unknown) => {
    const text = stringField(part, "text");
    return text === undefined ? [] : [text];
  });
  return texts.length === 0 ? undefined : texts.join("\n");
};

interface ActiveTurn {
  readonly input: ProviderAdapterV2TurnInput;
  readonly items: Map<string, OrchestrationV2TurnItem>;
  /** Content blocks seen per Claude message, so a whole message lines up with its streamed blocks. */
  readonly blocksSeen: Map<string, number>;
  currentMessageId: string | undefined;
}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/**
 * One Claude instance's adapter, given its **Binary path** and the server's
 * environment. The query runner comes from the context: production's or a
 * replay.
 */
export const makeClaudeAdapter = Effect.fn("makeClaudeAdapter")(function* (input: {
  readonly instanceId: ProviderInstanceId;
  readonly binaryPath: string;
  readonly environment: ProcessEnvironment;
  readonly platform: NodeJS.Platform;
}): Effect.fn.Return<ProviderAdapterV2, never, ClaudeAgentSdkQueryRunner | FileSystem.FileSystem> {
  const runner = yield* ClaudeAgentSdkQueryRunner;
  const executablePath = yield* resolveClaudeSdkExecutablePath(input.binaryPath, {
    platform: input.platform,
    env: input.environment,
  });

  const adapterError =
    (operation: "open-session" | "ensure-thread" | "start-turn") => (cause: unknown) =>
      new ProviderAdapterV2Error({
        driver: "claudeAgent",
        operation,
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      });

  const openSession: ProviderAdapterV2["openSession"] = (open) =>
    Effect.gen(function* () {
      // A thread that has talked to Claude before resumes that session, as
      // T3 Code's `makeClaudeQueryOptions` does with `resume`; a new one
      // gets a session id of its own.
      const resume = open.initialNativeThreadId !== undefined;
      const nativeSessionId = open.initialNativeThreadId ?? (yield* runner.allocateSessionId);
      const options = makeClaudeQueryOptions({
        modelSelection: open.modelSelection,
        runtimeMode: open.runtimePolicy.runtimeMode,
        nativeSessionId,
        resume,
        cwd: open.runtimePolicy.cwd,
        executablePath,
        environment: input.environment,
      });
      const session = yield* runner.open({ options, threadId: open.threadId });
      const events = yield* PubSub.unbounded<ProviderAdapterV2Event>();
      const live = yield* Ref.make(true);
      const model = yield* Ref.make(open.modelSelection.model);
      const activeTurn = yield* Ref.make<ActiveTurn | undefined>(undefined);
      const createdAt = yield* nowIso;

      const publish = (event: ProviderAdapterV2Event) => PubSub.publish(events, event);

      const itemBase = (turn: ActiveTurn, id: TurnItemId, nodeId: NodeId, now: string) => ({
        id,
        threadId: turn.input.threadId,
        runId: turn.input.runId,
        nodeId,
        providerThreadId: turn.input.providerThread.id,
        providerTurnId: turn.input.providerTurnId,
        ordinal: 0,
        title: null,
        startedAt: now,
        completedAt: null,
        updatedAt: now,
      });

      const node = (
        turn: ActiveTurn,
        id: NodeId,
        kind: OrchestrationV2ExecutionNode["kind"],
        status: OrchestrationV2ExecutionNode["status"],
        startedAt: string | null,
        completedAt: string | null,
      ): OrchestrationV2ExecutionNode => ({
        id,
        threadId: turn.input.threadId,
        runId: turn.input.runId,
        parentNodeId: turn.input.rootNodeId,
        rootNodeId: turn.input.rootNodeId,
        kind,
        status,
        providerThreadId: turn.input.providerThread.id,
        providerTurnId: turn.input.providerTurnId,
        startedAt,
        completedAt,
      });

      const putItem = (
        turn: ActiveTurn,
        key: string,
        item: OrchestrationV2TurnItem,
        kind: OrchestrationV2ExecutionNode["kind"],
      ) =>
        Effect.gen(function* () {
          const previous = turn.items.get(key);
          turn.items.set(key, item);
          const terminal = item.completedAt !== null;
          // A node is announced when its item starts and again when it ends.
          if (previous === undefined || terminal) {
            yield* publish({
              type: "node.updated",
              node: node(
                turn,
                item.nodeId ?? turn.input.rootNodeId,
                kind,
                item.status,
                item.startedAt,
                item.completedAt,
              ),
            });
          }
          yield* publish({ type: "turn_item.updated", turnItem: item });
        });

      const textKey = (messageId: string, index: number) => `${messageId}:${index}`;

      const startText = (turn: ActiveTurn, messageId: string, index: number, text: string) =>
        Effect.gen(function* () {
          const key = textKey(messageId, index);
          if (turn.items.has(key)) return;
          const now = yield* nowIso;
          yield* putItem(
            turn,
            key,
            {
              ...itemBase(
                turn,
                TurnItemId.make(`item:claude:${key}`),
                NodeId.make(`node:claude:${key}`),
                now,
              ),
              status: "running",
              type: "assistant_message",
              messageId: MessageId.make(`message:claude:${key}`),
              text,
              streaming: true,
            },
            "assistant_message",
          );
        });

      const handleStreamEvent = (turn: ActiveTurn, message: SDKPartialAssistantMessage) =>
        Effect.gen(function* () {
          const event = message.event;
          switch (event.type) {
            case "message_start":
              turn.currentMessageId = event.message.id;
              return;
            case "content_block_start":
              if (event.content_block.type === "text" && turn.currentMessageId !== undefined) {
                yield* startText(
                  turn,
                  turn.currentMessageId,
                  event.index,
                  event.content_block.text,
                );
              }
              return;
            case "content_block_delta": {
              if (event.delta.type !== "text_delta" || turn.currentMessageId === undefined) return;
              const key = textKey(turn.currentMessageId, event.index);
              const item = turn.items.get(key);
              if (item?.type !== "assistant_message" || !item.streaming) return;
              const now = yield* nowIso;
              yield* putItem(
                turn,
                key,
                { ...item, text: item.text + event.delta.text, updatedAt: now },
                "assistant_message",
              );
              return;
            }
            default:
              return;
          }
        });

      const handleToolUse = (
        turn: ActiveTurn,
        block: Extract<ContentBlock, { readonly type: "tool_use" }>,
      ) =>
        Effect.gen(function* () {
          if (turn.items.has(block.id)) return;
          const now = yield* nowIso;
          const base = {
            ...itemBase(
              turn,
              TurnItemId.make(`item:claude:${block.id}`),
              NodeId.make(`node:claude:${block.id}`),
              now,
            ),
            status: "running" as const,
          };
          const itemType = classifyClaudeTool(block.name);
          const fileName = stringField(block.input, "file_path", "path", "filename", "fileName");
          const newStr = stringField(block.input, "content", "new_string");
          const item: OrchestrationV2TurnItem =
            itemType === "file_change" && fileName !== undefined
              ? {
                  ...base,
                  type: "file_change",
                  fileName,
                  ...(newStr === undefined ? {} : { newStr }),
                }
              : itemType === "command_execution"
                ? {
                    ...base,
                    type: "command_execution",
                    input: stringField(block.input, "command") ?? "",
                  }
                : { ...base, type: "dynamic_tool", toolName: block.name, input: block.input };
          yield* putItem(turn, block.id, item, "tool_call");
        });

      const handleAssistant = (turn: ActiveTurn, message: SDKAssistantMessage) =>
        Effect.gen(function* () {
          const messageId = message.message.id;
          for (const block of message.message.content) {
            const index = turn.blocksSeen.get(messageId) ?? 0;
            turn.blocksSeen.set(messageId, index + 1);
            if (block.type === "text") {
              yield* startText(turn, messageId, index, "");
              const key = textKey(messageId, index);
              const item = turn.items.get(key);
              if (item?.type !== "assistant_message") continue;
              const now = yield* nowIso;
              yield* putItem(
                turn,
                key,
                {
                  ...item,
                  text: block.text,
                  streaming: false,
                  status: "completed",
                  completedAt: now,
                  updatedAt: now,
                },
                "assistant_message",
              );
            } else if (block.type === "tool_use") {
              yield* handleToolUse(turn, block);
            }
          }
        });

      const handleToolResults = (turn: ActiveTurn, message: SDKMessage & { type: "user" }) =>
        Effect.gen(function* () {
          const content = message.message.content;
          if (typeof content === "string") return;
          for (const block of content) {
            if (block.type !== "tool_result") continue;
            const item = turn.items.get(block.tool_use_id);
            if (item === undefined || item.completedAt !== null) continue;
            const now = yield* nowIso;
            const status = block.is_error === true ? ("failed" as const) : ("completed" as const);
            const output = toolResultText(block.content);
            const ended = { ...item, status, completedAt: now, updatedAt: now };
            const withOutput: OrchestrationV2TurnItem =
              ended.type === "command_execution" && output !== undefined
                ? { ...ended, output }
                : ended.type === "dynamic_tool" && block.content !== undefined
                  ? { ...ended, output: block.content }
                  : ended;
            yield* putItem(turn, block.tool_use_id, withOutput, "tool_call");
          }
        });

      const endTurn = (
        turn: ActiveTurn,
        status: "completed" | "failed",
        failure: OrchestrationV2ProviderFailure | null,
      ) =>
        Effect.gen(function* () {
          // Anything still open ends with the turn.
          const now = yield* nowIso;
          for (const [key, item] of turn.items) {
            if (item.completedAt !== null) continue;
            const ended = { ...item, status, completedAt: now, updatedAt: now };
            yield* putItem(
              turn,
              key,
              ended.type === "assistant_message" ? { ...ended, streaming: false } : ended,
              ended.type === "assistant_message" ? "assistant_message" : "tool_call",
            );
          }
          yield* Ref.set(activeTurn, undefined);
          yield* publish(
            failure === null
              ? {
                  type: "turn.terminal",
                  providerTurnId: turn.input.providerTurnId,
                  status: "completed",
                  failure: null,
                }
              : {
                  type: "turn.terminal",
                  providerTurnId: turn.input.providerTurnId,
                  status: "failed",
                  failure,
                },
          );
        });

      const handleResult = (turn: ActiveTurn, result: SDKResultMessage) => {
        if (result.subtype === "success" && !result.is_error) {
          return endTurn(turn, "completed", null);
        }
        const detail =
          result.subtype === "success" ? result.result : result.errors.join("\n") || result.subtype;
        return endTurn(turn, "failed", {
          class: "provider_error",
          message:
            detail.trim().length === 0
              ? "Claude ended the turn with an error."
              : detail.slice(0, 4_096),
        });
      };

      const handleMessage = (message: SDKMessage) =>
        Effect.gen(function* () {
          const turn = yield* Ref.get(activeTurn);
          // Subagents' messages carry their parent tool's id; subagents are absent.
          if (
            turn === undefined ||
            ("parent_tool_use_id" in message && message.parent_tool_use_id !== null)
          ) {
            return;
          }
          switch (message.type) {
            case "stream_event":
              return yield* handleStreamEvent(turn, message);
            case "assistant":
              return yield* handleAssistant(turn, message);
            case "user":
              return yield* handleToolResults(turn, message);
            case "result":
              return yield* handleResult(turn, message);
            default:
              return;
          }
        });

      // The query's messages for as long as the session lives. When they end,
      // the session is gone, and a turn still running fails.
      yield* session.messages.pipe(
        Stream.runForEach(handleMessage),
        Effect.catch((error) =>
          Effect.logWarning("Claude's messages ended with an error.").pipe(
            Effect.annotateLogs({ error: error.message }),
          ),
        ),
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Ref.set(live, false);
            const turn = yield* Ref.get(activeTurn);
            if (turn === undefined) return;
            yield* endTurn(turn, "failed", {
              class: "transport_error",
              message: "Claude Code stopped before the turn finished.",
            });
          }),
        ),
        Effect.forkScoped,
      );

      const runtime: ProviderAdapterV2SessionRuntime = {
        driver: "claudeAgent",
        providerSession: {
          id: open.providerSessionId,
          driver: "claudeAgent",
          providerInstanceId: input.instanceId,
          status: "ready",
          cwd: open.runtimePolicy.cwd,
          model: open.modelSelection.model,
          createdAt,
          updatedAt: createdAt,
          lastError: null,
        },
        isLive: Ref.get(live),
        subscribeEvents: Effect.map(PubSub.subscribe(events), Stream.fromSubscription),
        ensureThread: ({ providerThread }) =>
          Effect.succeed({
            ...providerThread,
            nativeThreadRef: { driver: "claudeAgent", nativeId: nativeSessionId },
          }),
        startTurn: (turnInput) =>
          Effect.gen(function* () {
            if ((yield* Ref.get(activeTurn)) !== undefined) {
              return yield* adapterError("start-turn")("Claude is still running a turn.");
            }
            if (!(yield* Ref.get(live))) {
              return yield* adapterError("start-turn")("Claude Code is no longer running.");
            }
            const nextModel = turnInput.modelSelection.model;
            if ((yield* Ref.get(model)) !== nextModel) {
              yield* session.setModel(nextModel).pipe(Effect.mapError(adapterError("start-turn")));
              yield* Ref.set(model, nextModel);
            }
            yield* Ref.set(activeTurn, {
              input: turnInput,
              items: new Map(),
              blocksSeen: new Map(),
              currentMessageId: undefined,
            });
            yield* session.offer(makeClaudeUserMessage(turnInput.message.text)).pipe(
              Effect.tapError(() => Ref.set(activeTurn, undefined)),
              Effect.mapError(adapterError("start-turn")),
            );
          }),
      };
      return runtime;
    }).pipe(Effect.mapError(adapterError("open-session")));

  return {
    instanceId: input.instanceId,
    driver: "claudeAgent",
    openSession,
  } satisfies ProviderAdapterV2;
});

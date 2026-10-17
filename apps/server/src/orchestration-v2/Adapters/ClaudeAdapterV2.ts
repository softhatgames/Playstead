import {
  type CanUseTool,
  type Options as ClaudeQueryOptions,
  type EffortLevel,
  type PermissionResult,
  type Query,
  query,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  MessageId,
  NodeId,
  RuntimeRequestId,
  type ThreadId,
  TurnItemId,
} from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2ExecutionNode,
  OrchestrationV2ProviderFailure,
  OrchestrationV2TurnItem,
  OrchestrationV2UserInputQuestion,
  ProviderUserInputAnswers,
  RuntimeMode,
} from "@playstead/contracts/orchestrationV2";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import {
  INTERRUPT_TERMINAL_TIMEOUT,
  type ProviderAdapterV2,
  ProviderAdapterV2Error,
  type ProviderAdapterV2Event,
  type ProviderAdapterV2SessionRuntime,
  type ProviderAdapterV2TurnInput,
} from "@playstead/provider-core/server/ProviderAdapter";
import { applyClaudePromptEffortPrefix } from "@playstead/shared/model";
import type { ProcessEnvironment } from "@playstead/shared/shell";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import {
  type CompiledClaudeModelSelection,
  compileClaudeModelSelection,
} from "../../provider/ClaudeModelCatalog.ts";
import { resolveClaudeSdkExecutablePath } from "../../provider/Drivers/ClaudeExecutable.ts";

/**
 * Claude through the Claude Agent SDK's `query()`, following T3 Code's
 * `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` at 2577baf,
 * trimmed to starting, interrupting and answering turns.
 *
 * - One `query()` per session, fed messages through a streaming prompt; a
 *   thread's next turn offers its message to the same query.
 * - The query opens in the session's runtime mode as the SDK's permission
 *   mode (Supervised `default`, Auto-accept edits `acceptEdits`, Auto
 *   `auto`, Full access `bypassPermissions`). It cannot change mode in
 *   session, so a turn in another mode reopens it, resuming the same Claude
 *   session, as T3 Code does; T3 Code's `setPermissionMode` only restores
 *   a mode Claude Code changed itself, which needs plan mode.
 * - Assistant text streams from the SDK's partial messages. T3 Code asks for
 *   them too but shows text only when each whole message arrives.
 * - A file write is a `file_change` item carrying the file's name and the
 *   content the Write tool was given, which T3 Code's item leaves out.
 *
 * - The model selection is compiled as T3 Code's `compileClaudeModelSelection`
 *   compiles it: the query opens with the model, its effort (the model's
 *   default unless chosen), Fast Mode and Ultracode as settings, and
 *   summarised thinking. A turn whose selection differs from the query's
 *   changes it first with the SDK's `setModel` and `applyFlagSettings`, as T3
 *   Code does when the selection can change live; with Playstead's models it
 *   always can. Ultrathink goes in the prompt as T3 Code's `Ultrathink:`
 *   prefix.
 * - Each message goes out with its own uuid, and only the frames Claude Code
 *   stamps with it belong to the turn: Claude Code also runs turns of its
 *   own, for example when a background command finishes, and their `result`
 *   must not end the person's turn. T3 Code ends the active turn on any
 *   `result`.
 * - An interrupt is the SDK's `interrupt()` (T3 Code's `interruptTurn`); the
 *   turn ends interrupted on Claude's `result`, or after
 *   `INTERRUPT_TERMINAL_TIMEOUT` without one. Unlike T3 Code, the query is
 *   not closed, so the thread's next message continues the same session.
 *
 * - `AskUserQuestion` reaches the person as a user-input request, as T3
 *   Code's `canUseTool` routes it: Claude Code asks `canUseTool` for it even
 *   under `bypassPermissions` (Claude 2.1.301, SDK 0.3.276; the SDK's
 *   warning that `canUseTool` is never called is wrong for this tool). The
 *   answers go back as the tool's `answers`; an interrupt releases the
 *   question unanswered. Any other tool Claude Code asks about is allowed
 *   in Auto and Full access, and refused in Supervised and Auto-accept
 *   edits, where T3 Code asks the person: approvals are absent.
 *
 * Absent, as in the slice as a whole: approvals, showing thinking, MCP,
 * subagents, attachments and usage.
 */

export type ClaudeAgentSdkQueryOptions = ClaudeQueryOptions;

type ClaudeFlagSettings = Parameters<Query["applyFlagSettings"]>[0];

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
  /** Changes Claude Code's settings, such as effort and fast mode, for the next turns. */
  readonly applyFlagSettings: (
    settings: ClaudeFlagSettings,
  ) => Effect.Effect<void, ClaudeAgentSdkQueryRunnerError>;
  /** Asks Claude Code to stop the turn it is running. */
  readonly interrupt: Effect.Effect<void, ClaudeAgentSdkQueryRunnerError>;
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
              applyFlagSettings: (settings) =>
                Effect.tryPromise({
                  try: () => queryRuntime.applyFlagSettings(settings),
                  catch: runnerError("applyFlagSettings"),
                }),
              interrupt: Effect.tryPromise({
                try: () => queryRuntime.interrupt(),
                catch: runnerError("interrupt"),
              }).pipe(Effect.asVoid),
            };
          }),
      });
    }),
  );

/**
 * Each runtime mode as the SDK's permission mode (T3 Code's
 * `permissionModeForClaudeRuntimePolicy` and
 * `claudeRuntimeQueryPolicyForRuntimePolicy`, without the project and
 * instance overrides Playstead does not have). Only Full access skips
 * Claude Code's permission checks.
 */
const permissionModeForRuntimeMode = (
  runtimeMode: RuntimeMode,
): Pick<ClaudeQueryOptions, "permissionMode" | "allowDangerouslySkipPermissions"> => {
  switch (runtimeMode) {
    case "approval-required":
      return { permissionMode: "default" };
    case "auto-accept-edits":
      return { permissionMode: "acceptEdits" };
    case "auto":
      return { permissionMode: "auto" };
    case "full-access":
      return { permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true };
  }
};

/**
 * Whether the person must approve the tools Claude Code asks about (T3
 * Code's `installPermissionCallback`): in Supervised and Auto-accept edits.
 * `acceptEdits` approves edits before asking; whatever else it asks about
 * must be asked of the person, not allowed. In Auto and Full access Claude
 * Code's own checks decide, and a tool it still asks about is allowed.
 */
const requiresClaudeApproval = (runtimeMode: RuntimeMode) =>
  runtimeMode === "approval-required" || runtimeMode === "auto-accept-edits";

/**
 * The options a session's query opens with (T3 Code's `makeClaudeQueryOptions`):
 * Claude Code's own tools and system prompt, partial messages, the session id
 * the thread will keep (or resumes), the permission callback, and the
 * person's `claude` with the server's environment, in the project's folder.
 */
const makeClaudeQueryOptions = (input: {
  readonly selection: CompiledClaudeModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly nativeSessionId: string;
  /** Continue the session Claude Code saved under that id, instead of starting it. */
  readonly resume: boolean;
  readonly cwd: string;
  readonly executablePath: string;
  readonly environment: ProcessEnvironment;
  readonly canUseTool: CanUseTool;
}): ClaudeAgentSdkQueryOptions => ({
  model: input.selection.apiModelId,
  tools: { type: "preset", preset: "claude_code" },
  ...permissionModeForRuntimeMode(input.runtimeMode),
  includePartialMessages: true,
  ...(input.selection.effort === undefined
    ? {}
    : { effort: input.selection.effort as EffortLevel }),
  ...(input.resume ? { resume: input.nativeSessionId } : { sessionId: input.nativeSessionId }),
  // T3 Code asks for summarised thinking unless the selection turns
  // thinking off, which none of Playstead's models offers.
  thinking: { type: "adaptive", display: "summarized" },
  settings: { ...input.selection.settings, showThinkingSummaries: true },
  systemPrompt: { type: "preset", preset: "claude_code" },
  cwd: input.cwd,
  additionalDirectories: [input.cwd],
  pathToClaudeCodeExecutable: input.executablePath,
  env: { ...input.environment },
  canUseTool: input.canUseTool,
  extraArgs: { "thinking-display": "summarized" },
});

/**
 * Whether a session can take the next selection without a new process (T3
 * Code's `canApplyClaudeSelectionLive`): thinking is a launch flag, and
 * clearing an explicit effort needs Claude Code to read its settings files
 * again. Neither can happen with Playstead's models, whose effort always
 * resolves and which offer no thinking choice.
 */
const canApplyClaudeSelectionLive = (
  live: CompiledClaudeModelSelection,
  next: CompiledClaudeModelSelection,
) => next.effort !== undefined || live.effort === undefined;

/** The flags a live change sets (T3 Code's `claudeLiveSelectionFlagSettings`). */
const claudeLiveSelectionFlagSettings = (
  selection: CompiledClaudeModelSelection,
): ClaudeFlagSettings => ({
  ...(selection.effort === undefined ? {} : { effortLevel: selection.effort as EffortLevel }),
  fastMode: selection.settings.fastMode ?? null,
  ultracode: selection.settings.ultracode ?? null,
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
  effort: options.effort,
  sessionId: options.sessionId,
  resume: options.resume,
  thinking: options.thinking,
  settings: options.settings,
  systemPrompt: options.systemPrompt,
  cwd: options.cwd,
  additionalDirectories: options.additionalDirectories,
  extraArgs: options.extraArgs,
});

/**
 * A plain-text message from the person, as T3 Code's `makeClaudeUserMessage`
 * builds one, with the uuid Claude Code stamps on the turn's frames.
 */
const makeClaudeUserMessage = (text: string, uuid: string): SDKUserMessage => ({
  type: "user",
  message: { role: "user", content: text },
  parent_tool_use_id: null,
  uuid: uuid as SDKUserMessage["uuid"] & string,
});

/** A turn's prompt uuid: its provider turn id is `provider-turn:<uuid>`. */
const promptUuidFor = (providerTurnId: string) => providerTurnId.replace(/^provider-turn:/, "");

/** Whether Claude Code stamped this frame with a prompt, and which. */
const stampOf = (message: SDKMessage): string | undefined => {
  const stamp: unknown = Reflect.get(message, "user_message_uuid");
  return typeof stamp === "string" ? stamp : undefined;
};

/**
 * Whether a `result` answers the turn's prompt. A result without any echo
 * comes from a Claude Code too old to stamp, or from a turn of its own that
 * answered no prompt; only the first is the turn's.
 */
const resultAnswers = (result: SDKResultMessage, promptUuid: string) => {
  const uuids =
    result.user_message_uuids ??
    (result.user_message_uuid === undefined ? undefined : [result.user_message_uuid]);
  if (uuids !== undefined) return uuids.includes(promptUuid);
  return result.result_index === undefined;
};

/**
 * `AskUserQuestion`'s questions (T3 Code's `claudeUserInputQuestions`): the
 * question's text is its id, which Claude's answers are keyed by.
 */
const claudeUserInputQuestions = (
  input: Record<string, unknown>,
): ReadonlyArray<OrchestrationV2UserInputQuestion> => {
  const questions: unknown = input["questions"];
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((value: unknown, index) => {
    const question = stringField(value, "question")?.trim();
    if (question === undefined) return [];
    const options: unknown = Reflect.get(value as object, "options");
    return [
      {
        id: question,
        header: stringField(value, "header")?.trim() ?? `Question ${index + 1}`,
        question,
        options: Array.isArray(options)
          ? options.flatMap((option: unknown) => {
              const label = stringField(option, "label")?.trim();
              return label === undefined
                ? []
                : [{ label, description: stringField(option, "description")?.trim() ?? "" }];
            })
          : [],
        ...(Reflect.get(value as object, "multiSelect") === true ? { multiSelect: true } : {}),
      },
    ];
  });
};

/** The answers as `AskUserQuestion` takes them (T3 Code's `claudeSdkUserInputAnswers`): several picks join with commas. */
const claudeSdkUserInputAnswers = (answers: ProviderUserInputAnswers): Record<string, string> =>
  Object.fromEntries(
    Object.entries(answers).map(([question, answer]) => [
      question,
      typeof answer === "string" ? answer : answer.join(", "),
    ]),
  );

/** A question Claude waits on; `undefined` releases it unanswered. */
interface PendingQuestion {
  readonly turn: ActiveTurn;
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers | undefined>;
}

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
  readonly promptUuid: string;
  readonly items: Map<string, OrchestrationV2TurnItem>;
  /** Content blocks seen per Claude message, so a whole message lines up with its streamed blocks. */
  readonly blocksSeen: Map<string, number>;
  currentMessageId: string | undefined;
  /** Whether the turn Claude Code is running answers this prompt. */
  owned: boolean;
  /** Set once the person asked to stop it. */
  interrupting: boolean;
  readonly ended: Deferred.Deferred<void>;
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

  const adapterError = (operation: ProviderAdapterV2Error["operation"]) => (cause: unknown) =>
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
      const events = yield* PubSub.unbounded<ProviderAdapterV2Event>();
      const activeTurn = yield* Ref.make<ActiveTurn | undefined>(undefined);
      const pendingQuestions = new Map<RuntimeRequestId, PendingQuestion>();
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      const publish = (event: ProviderAdapterV2Event) => PubSub.publish(events, event);

      /** Releases the turn's questions unanswered, so Claude can stop. */
      const releaseQuestions = (turn: ActiveTurn) =>
        Effect.forEach(
          [...pendingQuestions.values()].filter((pending) => pending.turn === turn),
          (pending) => Deferred.succeed(pending.answers, undefined),
          { discard: true },
        );

      /**
       * T3 Code's `canUseToolEffect`, without approvals: `AskUserQuestion`
       * becomes a user-input request (its node, its item, then the request,
       * as T3 Code's `buildApprovalRequestArtifacts` builds them) and waits
       * for the answers; any other tool is allowed as it is, unless the
       * mode needs the person's approval (`requiresClaudeApproval`). The question
       * belongs to the turn running now: a callback is not a frame Claude
       * Code stamps with the prompt.
       */
      const canUseToolEffect = Effect.fnUntraced(function* (
        toolName: Parameters<CanUseTool>[0],
        toolInput: Parameters<CanUseTool>[1],
        callbackOptions: Parameters<CanUseTool>[2],
      ) {
        const turn = yield* Ref.get(activeTurn);
        if (turn === undefined) {
          return {
            behavior: "deny",
            message: "No turn is running for this tool request.",
            toolUseID: callbackOptions.toolUseID,
          } satisfies PermissionResult;
        }
        if (toolName !== "AskUserQuestion") {
          if (requiresClaudeApproval(open.runtimePolicy.runtimeMode)) {
            // T3 Code asks the person here; until approvals exist the tool
            // is refused, so these modes never run what they would ask about.
            return {
              behavior: "deny",
              message: "Approvals are not available yet, so this tool was not run.",
              toolUseID: callbackOptions.toolUseID,
            } satisfies PermissionResult;
          }
          return {
            behavior: "allow",
            updatedInput: toolInput,
            toolUseID: callbackOptions.toolUseID,
          } satisfies PermissionResult;
        }
        const toolUseId = callbackOptions.toolUseID;
        const requestId = RuntimeRequestId.make(`runtime-request:claude:${toolUseId}`);
        const nodeId = NodeId.make(`node:claude:${toolUseId}:question`);
        const now = yield* nowIso;
        const answers = yield* Deferred.make<ProviderUserInputAnswers | undefined>();
        pendingQuestions.set(requestId, { turn, answers });
        yield* publish({
          type: "node.updated",
          node: {
            id: nodeId,
            threadId: turn.input.threadId,
            runId: turn.input.runId,
            parentNodeId: turn.input.rootNodeId,
            rootNodeId: turn.input.rootNodeId,
            kind: "user_input_request",
            status: "waiting",
            providerThreadId: turn.input.providerThread.id,
            providerTurnId: turn.input.providerTurnId,
            startedAt: now,
            completedAt: null,
          },
        });
        yield* publish({
          type: "turn_item.updated",
          turnItem: {
            id: TurnItemId.make(`item:claude:${toolUseId}:question`),
            threadId: turn.input.threadId,
            runId: turn.input.runId,
            nodeId,
            providerThreadId: turn.input.providerThread.id,
            providerTurnId: turn.input.providerTurnId,
            ordinal: 0,
            status: "waiting",
            title: null,
            startedAt: now,
            completedAt: null,
            updatedAt: now,
            type: "user_input_request",
            requestId,
            questions: claudeUserInputQuestions(toolInput),
          },
        });
        yield* publish({
          type: "runtime_request.updated",
          runtimeRequest: {
            id: requestId,
            nodeId,
            providerTurnId: turn.input.providerTurnId,
            kind: "user_input",
            status: "pending",
            responseCapability: { type: "live", providerSessionId: open.providerSessionId },
            createdAt: now,
            resolvedAt: null,
          },
        });
        // An interrupt aborts the signal, and releases the question too.
        const aborted = Effect.callback<undefined>((resume) => {
          const abort = () => resume(Effect.succeed(undefined));
          callbackOptions.signal.addEventListener("abort", abort, { once: true });
          if (callbackOptions.signal.aborted) abort();
          return Effect.sync(() => callbackOptions.signal.removeEventListener("abort", abort));
        });
        const given = yield* Effect.raceFirst(Deferred.await(answers), aborted).pipe(
          Effect.ensuring(Effect.sync(() => pendingQuestions.delete(requestId))),
        );
        return given === undefined
          ? ({
              behavior: "deny",
              message: "User cancelled tool execution.",
            } satisfies PermissionResult)
          : ({
              behavior: "allow",
              updatedInput: {
                questions: toolInput["questions"],
                answers: claudeSdkUserInputAnswers(given),
              },
              toolUseID: toolUseId,
            } satisfies PermissionResult);
      });

      const openedSelection = compileClaudeModelSelection(open.modelSelection);
      const options = makeClaudeQueryOptions({
        selection: openedSelection,
        runtimeMode: open.runtimePolicy.runtimeMode,
        nativeSessionId,
        resume,
        cwd: open.runtimePolicy.cwd,
        executablePath,
        environment: input.environment,
        canUseTool: (toolName, toolInput, callbackOptions) =>
          runPromise(canUseToolEffect(toolName, toolInput, callbackOptions)),
      });
      const session = yield* runner.open({ options, threadId: open.threadId });
      const live = yield* Ref.make(true);
      /** The selection the query runs now. */
      const liveSelection = yield* Ref.make(openedSelection);
      const createdAt = yield* nowIso;

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
            // A tool the interrupt cut short was stopped, not failed.
            const status =
              block.is_error !== true
                ? ("completed" as const)
                : turn.interrupting
                  ? ("interrupted" as const)
                  : ("failed" as const);
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
        status: "completed" | "interrupted" | "failed",
        failure: OrchestrationV2ProviderFailure | null,
      ) =>
        Effect.gen(function* () {
          // Ends once: Claude's result and the interrupt's timeout may race.
          if ((yield* Ref.get(activeTurn)) !== turn) return;
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
          yield* releaseQuestions(turn);
          yield* Deferred.succeed(turn.ended, undefined);
          yield* publish(
            failure === null
              ? {
                  type: "turn.terminal",
                  providerTurnId: turn.input.providerTurnId,
                  status: status === "failed" ? "completed" : status,
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
        if (!resultAnswers(result, turn.promptUuid)) return Effect.void;
        // T3 Code's `terminalStatusFromResult`, and its `interruptedTurns`.
        if (
          turn.interrupting ||
          result.terminal_reason === "aborted_tools" ||
          result.terminal_reason === "aborted_streaming"
        ) {
          return endTurn(turn, "interrupted", null);
        }
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
          // Each of Claude Code's turns starts with `init`; the frames it
          // stamps with a prompt's uuid say whose turn it is.
          if (message.type === "system" && message.subtype === "init") {
            turn.owned = false;
            return;
          }
          const stamp = stampOf(message);
          if (stamp !== undefined) turn.owned = stamp === turn.promptUuid;
          if (message.type === "result") return yield* handleResult(turn, message);
          if (!turn.owned) return;
          switch (message.type) {
            case "stream_event":
              return yield* handleStreamEvent(turn, message);
            case "assistant":
              return yield* handleAssistant(turn, message);
            case "user":
              return yield* handleToolResults(turn, message);
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
            // T3 Code's `openQuery`: a different selection changes the
            // running query's model and flags, when it can live.
            const next = compileClaudeModelSelection(turnInput.modelSelection);
            const current = yield* Ref.get(liveSelection);
            if (current.queryIdentity !== next.queryIdentity) {
              if (!canApplyClaudeSelectionLive(current, next)) {
                return yield* adapterError("start-turn")(
                  "Claude Code cannot change to this model selection without a new session.",
                );
              }
              yield* session
                .setModel(next.apiModelId)
                .pipe(
                  Effect.andThen(session.applyFlagSettings(claudeLiveSelectionFlagSettings(next))),
                  Effect.mapError(adapterError("start-turn")),
                );
              yield* Ref.set(liveSelection, next);
            }
            const promptUuid = promptUuidFor(turnInput.providerTurnId);
            yield* Ref.set(activeTurn, {
              input: turnInput,
              promptUuid,
              items: new Map(),
              blocksSeen: new Map(),
              currentMessageId: undefined,
              owned: false,
              interrupting: false,
              ended: yield* Deferred.make<void>(),
            });
            const text = applyClaudePromptEffortPrefix(turnInput.message.text, next.promptEffort);
            yield* session.offer(makeClaudeUserMessage(text, promptUuid)).pipe(
              Effect.tapError(() => Ref.set(activeTurn, undefined)),
              Effect.mapError(adapterError("start-turn")),
            );
          }),
        interruptTurn: ({ providerTurnId }) =>
          Effect.gen(function* () {
            const turn = yield* Ref.get(activeTurn);
            if (turn === undefined || turn.input.providerTurnId !== providerTurnId) return;
            turn.interrupting = true;
            const stopped = yield* session.interrupt.pipe(
              // Claude Code aborts a question's callback itself; release it anyway.
              Effect.andThen(releaseQuestions(turn)),
              Effect.andThen(Deferred.await(turn.ended)),
              Effect.timeoutOption(INTERRUPT_TERMINAL_TIMEOUT),
              Effect.mapError(adapterError("interrupt-turn")),
              Effect.ensuring(
                // Claude never answered: the turn ends here, so the next can start.
                Effect.suspend(() =>
                  Deferred.isDone(turn.ended).pipe(
                    Effect.flatMap((ended) =>
                      ended ? Effect.void : endTurn(turn, "interrupted", null),
                    ),
                  ),
                ),
              ),
            );
            if (stopped._tag === "None") {
              yield* Effect.logWarning("Claude did not end an interrupted turn in time.");
            }
          }),
        respondToRuntimeRequest: ({ requestId, answers }) =>
          Effect.suspend(() => {
            const pending = pendingQuestions.get(requestId);
            return pending === undefined
              ? Effect.fail(
                  adapterError("respond-to-runtime-request")(
                    `Claude is not waiting on runtime request ${requestId}.`,
                  ),
                )
              : Deferred.succeed(pending.answers, answers).pipe(Effect.asVoid);
          }),
      };
      return runtime;
    }).pipe(Effect.mapError(adapterError("open-session")));

  return {
    instanceId: input.instanceId,
    driver: "claudeAgent",
    // A query keeps the permission mode it opened with; another mode reopens it.
    capabilities: { sessions: { supportsRuntimeModeSwitchInSession: false } },
    openSession,
  } satisfies ProviderAdapterV2;
});

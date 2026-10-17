import {
  type CanUseTool,
  type Options as ClaudeQueryOptions,
  type EffortLevel,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
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
  PlanId,
  RuntimeRequestId,
  type ThreadId,
  TurnItemId,
} from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2ExecutionNode,
  OrchestrationV2PlanArtifact,
  OrchestrationV2PlanStep,
  OrchestrationV2ProviderFailure,
  OrchestrationV2TurnItem,
  OrchestrationV2UserInputQuestion,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ProviderRequestKind,
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
 *   `auto`, Full access `bypassPermissions`), or `plan` in plan mode. It
 *   cannot change mode in session, so a turn in another mode reopens it,
 *   resuming the same Claude session, as T3 Code does. `setPermissionMode`
 *   only puts back, before the next prompt, the mode Claude Code left on
 *   its own: approving an edit for the session moves it to `acceptEdits`
 *   (its suggestion), so in Supervised that allowance lasts until the turn
 *   ends, as in T3 Code; EnterPlanMode and a refused ExitPlanMode are put
 *   back the same way.
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
 *   question unanswered.
 * - Any other tool Claude Code asks about is allowed in Auto and Full
 *   access. In Supervised and Auto-accept edits it reaches the person as an
 *   approval request, of the kind the tool's classification gives, with
 *   Claude Code's own prompt (T3 Code's `canUseToolEffect`), and the
 *   decision goes back as T3 Code's `permissionResultFromDecision` builds
 *   it, except that `acceptAlways` approves for the session, as Codex
 *   does, where T3 Code's falls through to deny. An interrupt cancels the
 *   approval, which T3 Code's adapter leaves waiting.
 *
 * - The plan `ExitPlanMode` proposes becomes the thread's proposed plan, and
 *   the call is refused so Claude stops there, as T3 Code's `canUseTool`
 *   does; `TodoWrite`, and the task tools Claude Code 2.1 uses instead,
 *   become the thread's todo list. Each new plan of a kind replaces the
 *   thread's previous one.
 *
 * Absent, as in the slice as a whole: showing thinking, MCP, subagents,
 * attachments and usage.
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
  /** Puts Claude Code back in a permission mode it left on its own. */
  readonly setPermissionMode: (
    mode: PermissionMode,
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
              setPermissionMode: (mode) =>
                Effect.tryPromise({
                  try: () => queryRuntime.setPermissionMode(mode),
                  catch: runnerError("setPermissionMode"),
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
 * instance overrides Playstead does not have). Plan mode is the SDK's
 * `plan`, whatever the runtime mode, and never skips permissions. Only Full
 * access skips Claude Code's permission checks.
 */
const permissionModeForRuntimePolicy = (
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
): Pick<ClaudeQueryOptions, "permissionMode" | "allowDangerouslySkipPermissions"> => {
  if (interactionMode === "plan") return { permissionMode: "plan" };
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
  readonly interactionMode: ProviderInteractionMode;
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
  ...permissionModeForRuntimePolicy(input.runtimeMode, input.interactionMode),
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
 * builds one, with the uuid Claude Code stamps on the turn's frames. A
 * steer goes with priority `now`.
 */
const makeClaudeUserMessage = (
  text: string,
  uuid: string,
  priority?: SDKUserMessage["priority"],
): SDKUserMessage => ({
  type: "user",
  message: { role: "user", content: text },
  parent_tool_use_id: null,
  ...(priority === undefined ? {} : { priority }),
  uuid: uuid as SDKUserMessage["uuid"] & string,
});

/**
 * Whether a `result` is Claude Code stopping the turn's current step for
 * a steer, not the turn's end (T3 Code's `isClaudeActiveSteeringAbortResult`):
 * a message with priority `now` aborts what is streaming or running.
 */
const isActiveSteeringAbortResult = (result: SDKResultMessage) =>
  result.terminal_reason === "aborted_streaming" || result.terminal_reason === "aborted_tools";

/** A turn's prompt uuid: its provider turn id is `provider-turn:<uuid>`. */
const promptUuidFor = (providerTurnId: string) => providerTurnId.replace(/^provider-turn:/, "");

/** Whether Claude Code stamped this frame with a prompt, and which. */
const stampOf = (message: SDKMessage): string | undefined => {
  const stamp: unknown = Reflect.get(message, "user_message_uuid");
  return typeof stamp === "string" ? stamp : undefined;
};

/**
 * Whether a `result` answers one of the turn's prompts: the message that
 * started it, or a steer. A result without any echo comes from a Claude
 * Code too old to stamp, or from a turn of its own that answered no prompt;
 * only the first is the turn's.
 */
const resultAnswers = (result: SDKResultMessage, promptUuids: ReadonlySet<string>) => {
  const uuids =
    result.user_message_uuids ??
    (result.user_message_uuid === undefined ? undefined : [result.user_message_uuid]);
  if (uuids !== undefined) return uuids.some((uuid) => promptUuids.has(uuid));
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

/** A tool's input, whether the SDK gives it as is or as T3 Code's `{type: "record", value}`. */
const toolInputValue = (input: unknown): unknown =>
  typeof input === "object" && input !== null && Reflect.get(input, "type") === "record"
    ? Reflect.get(input, "value")
    : input;

/** `TodoWrite`'s todos as steps (T3 Code's `claudeTodoSteps`). */
const claudeTodoSteps = (input: unknown): ReadonlyArray<OrchestrationV2PlanStep> => {
  const value = toolInputValue(input);
  const todos: unknown =
    typeof value === "object" && value !== null ? Reflect.get(value, "todos") : undefined;
  if (!Array.isArray(todos)) return [];
  return todos.flatMap((todo: unknown, index) => {
    const text = stringField(todo, "content")?.trim();
    if (text === undefined || text.length === 0) return [];
    const status: unknown = Reflect.get(todo as object, "status");
    return [
      {
        id: `todo-${index}`,
        text,
        status:
          status === "completed" ? "completed" : status === "in_progress" ? "running" : "pending",
      },
    ];
  });
};

/** A thread's task list as Claude Code's task tools leave it, by task id. */
type ClaudeTaskList = ReadonlyMap<string, Omit<OrchestrationV2PlanStep, "id">>;

const claudeTaskStatus = (value: unknown): OrchestrationV2PlanStep["status"] | undefined =>
  value === "pending"
    ? "pending"
    : value === "in_progress"
      ? "running"
      : value === "completed"
        ? "completed"
        : undefined;

const fieldOf = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

/**
 * The task list after one of Claude Code's task tools ran, or `undefined`
 * when the call changed nothing (T3 Code's `applyClaudeTaskTool`): Claude
 * Code 2.1 keeps its todo list with `TaskCreate`, `TaskUpdate` and
 * `TaskList` rather than `TodoWrite`.
 */
const applyClaudeTaskTool = (
  tasks: ClaudeTaskList,
  toolName: string,
  input: unknown,
  result: unknown,
): ClaudeTaskList | undefined => {
  if (toolName === "TaskList") {
    const listed = fieldOf(result, "tasks");
    if (!Array.isArray(listed)) return undefined;
    const next = new Map<string, Omit<OrchestrationV2PlanStep, "id">>();
    for (const task of listed) {
      const id = stringField(task, "id")?.trim();
      const text = stringField(task, "subject")?.trim();
      const status = claudeTaskStatus(fieldOf(task, "status"));
      if (id !== undefined && text !== undefined && status !== undefined) {
        next.set(id, { text, status });
      }
    }
    return next.size === 0 && tasks.size === 0 ? undefined : next;
  }
  if (toolName === "TaskCreate") {
    const created = fieldOf(result, "task");
    const id = stringField(created, "id")?.trim();
    const text = (stringField(created, "subject") ?? stringField(input, "subject"))?.trim();
    if (id === undefined || text === undefined) return undefined;
    return new Map(tasks).set(id, { text, status: "pending" });
  }
  if (toolName !== "TaskUpdate" || fieldOf(result, "success") === false) return undefined;
  const id = (stringField(input, "taskId") ?? stringField(result, "taskId"))?.trim();
  const task = id === undefined ? undefined : tasks.get(id);
  if (id === undefined || task === undefined) return undefined;
  const nativeStatus = fieldOf(input, "status");
  if (nativeStatus === "deleted") {
    const next = new Map(tasks);
    next.delete(id);
    return next;
  }
  const text = stringField(input, "subject")?.trim() ?? task.text;
  const status = claudeTaskStatus(nativeStatus) ?? task.status;
  if (text === task.text && status === task.status) return undefined;
  return new Map(tasks).set(id, { text, status });
};

/** The task list as steps (T3 Code's `claudeTaskSteps`). */
const claudeTaskSteps = (tasks: ClaudeTaskList): ReadonlyArray<OrchestrationV2PlanStep> =>
  [...tasks].map(([id, task]) => ({ id: `task-${id}`, ...task }));

/** The plan `ExitPlanMode` proposes (T3 Code's `claudeProposedPlan`). */
const claudeProposedPlan = (input: unknown): string | undefined =>
  stringField(toolInputValue(input), "plan")?.trim();

/**
 * What Claude Code is told when it proposes a plan: the interface holds it
 * now, so the call is refused and the turn ends there (T3 Code's message).
 */
const PROPOSED_PLAN_CAPTURED_MESSAGE =
  "The client captured your proposed plan. Stop here and wait for the user's feedback or implementation request in a later turn.";

/**
 * A request Claude waits on: a question, whose `undefined` releases it
 * unanswered, or an approval.
 */
type PendingRequest =
  | {
      readonly type: "user_input";
      readonly turn: ActiveTurn;
      readonly answers: Deferred.Deferred<ProviderUserInputAnswers | undefined>;
    }
  | {
      readonly type: "approval";
      readonly turn: ActiveTurn;
      readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
    };

type ClaudeToolItemType = "file_change" | "command_execution" | "dynamic_tool";

/**
 * T3 Code's `CLAUDE_KNOWN_TOOL_CLASSIFICATIONS` at 2577baf: each tool's
 * item, and the kind of approval it asks for. Web tools are dynamic tools
 * here: the web search item is absent.
 */
const CLAUDE_KNOWN_TOOL_CLASSIFICATIONS: Record<
  string,
  { readonly itemType: ClaudeToolItemType; readonly requestKind: ProviderRequestKind }
> = {
  agent: { itemType: "dynamic_tool", requestKind: "command" },
  bash: { itemType: "command_execution", requestKind: "command" },
  edit: { itemType: "file_change", requestKind: "file-change" },
  glob: { itemType: "dynamic_tool", requestKind: "file-read" },
  grep: { itemType: "dynamic_tool", requestKind: "file-read" },
  ls: { itemType: "dynamic_tool", requestKind: "file-read" },
  monitor: { itemType: "dynamic_tool", requestKind: "command" },
  multiedit: { itemType: "file_change", requestKind: "file-change" },
  notebookedit: { itemType: "file_change", requestKind: "file-change" },
  read: { itemType: "dynamic_tool", requestKind: "file-read" },
  sendmessage: { itemType: "dynamic_tool", requestKind: "command" },
  task: { itemType: "dynamic_tool", requestKind: "command" },
  taskstop: { itemType: "dynamic_tool", requestKind: "command" },
  todowrite: { itemType: "dynamic_tool", requestKind: "command" },
  toolsearch: { itemType: "dynamic_tool", requestKind: "command" },
  webfetch: { itemType: "dynamic_tool", requestKind: "command" },
  websearch: { itemType: "dynamic_tool", requestKind: "command" },
  write: { itemType: "file_change", requestKind: "file-change" },
};

/** T3 Code's `classifyClaudeNativeTool`: an unknown tool is a dynamic tool that asks as a command. */
const classifyClaudeTool = (toolName: string) =>
  CLAUDE_KNOWN_TOOL_CLASSIFICATIONS[toolName.toLowerCase().replaceAll(/[\s_-]/g, "")] ?? {
    itemType: "dynamic_tool" as const,
    requestKind: "command" as const,
  };

/** What the approval says when Claude Code gives no prompt (T3 Code's `summarizeClaudeToolRequest`). */
const summarizeClaudeToolRequest = (toolName: string, input: Record<string, unknown>) => {
  const command = stringField(input, "command", "cmd", "script")?.trim();
  if (command !== undefined) return `${toolName}: ${command.slice(0, 400)}`;
  const path = stringField(input, "file_path", "path", "filename", "fileName")?.trim();
  if (path !== undefined) return `${toolName}: ${path.slice(0, 400)}`;
  const serialized = JSON.stringify(input) ?? "";
  return serialized.length <= 400
    ? `${toolName}: ${serialized}`
    : `${toolName}: ${serialized.slice(0, 397)}...`;
};

/**
 * The person's decision as Claude Code takes it (T3 Code's
 * `permissionResultFromDecision` and `toSessionPermissionUpdates`). Approving
 * for the session also applies Claude Code's suggested rules for the
 * session, or allows the tool for the session when it suggests none;
 * `acceptAlways` does the same, where T3 Code's denies. Declining tells
 * Claude, which goes on; cancelling also stops the turn.
 */
const permissionResultFromDecision = (input: {
  readonly toolName: string;
  readonly decision: ProviderApprovalDecision;
  readonly toolInput: Record<string, unknown>;
  readonly toolUseID: string;
  readonly suggestions?: ReadonlyArray<PermissionUpdate>;
}): PermissionResult => {
  switch (input.decision) {
    case "accept":
      return {
        behavior: "allow",
        updatedInput: input.toolInput,
        toolUseID: input.toolUseID,
        decisionClassification: "user_temporary",
      };
    case "acceptForSession":
    case "acceptAlways": {
      const suggested = (input.suggestions ?? []).map((suggestion): PermissionUpdate => ({
        ...suggestion,
        destination: "session",
      }));
      return {
        behavior: "allow",
        updatedInput: input.toolInput,
        toolUseID: input.toolUseID,
        decisionClassification: "user_permanent",
        updatedPermissions:
          suggested.length > 0
            ? suggested
            : [
                {
                  type: "addRules",
                  rules: [{ toolName: input.toolName }],
                  behavior: "allow",
                  destination: "session",
                },
              ],
      };
    }
    case "decline":
      return {
        behavior: "deny",
        message: "User declined tool execution.",
        toolUseID: input.toolUseID,
        decisionClassification: "user_reject",
      };
    case "cancel":
      return {
        behavior: "deny",
        message: "User cancelled tool execution.",
        toolUseID: input.toolUseID,
        decisionClassification: "user_reject",
        interrupt: true,
      };
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
  /** The uuids of the turn's prompts: the message that started it, then each steer. */
  readonly promptUuids: Set<string>;
  /** Set once a steer was offered (T3 Code's `steeredTurns`). */
  steered: boolean;
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
}): Effect.fn.Return<
  ProviderAdapterV2,
  never,
  ClaudeAgentSdkQueryRunner | FileSystem.FileSystem | Crypto.Crypto
> {
  const runner = yield* ClaudeAgentSdkQueryRunner;
  const crypto = yield* Crypto.Crypto;
  // Each thread's latest plan of each kind, across its sessions, so a new one replaces it.
  const latestPlans = new Map<string, OrchestrationV2PlanArtifact>();
  // Each thread's task list as Claude Code's task tools keep it (T3 Code keys it by session).
  const taskLists = new Map<ThreadId, ClaudeTaskList>();
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
      const pendingRequests = new Map<RuntimeRequestId, PendingRequest>();
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      const publish = (event: ProviderAdapterV2Event) => PubSub.publish(events, event);

      /** Releases the turn's questions unanswered and cancels its approvals, so Claude can stop. */
      const releaseRequests = (turn: ActiveTurn) =>
        Effect.forEach(
          [...pendingRequests.values()].filter((pending) => pending.turn === turn),
          (pending) =>
            pending.type === "user_input"
              ? Deferred.succeed(pending.answers, undefined)
              : Deferred.succeed(pending.decision, "cancel"),
          { discard: true },
        );

      /**
       * A proposed plan or a todo list as its node, plan and item (T3 Code's
       * `emitClaudePlanProjection`): each tool call is a plan of its own, and
       * replaces the thread's previous plan of that kind unless that one is
       * done. A proposed plan stays active until a message implements it; a
       * todo list until every step is done.
       */
      const emitPlan = (
        turn: ActiveTurn,
        toolUseId: string,
        content:
          | { readonly kind: "proposed_plan"; readonly markdown: string }
          | { readonly kind: "todo_list"; readonly steps: ReadonlyArray<OrchestrationV2PlanStep> },
      ) =>
        Effect.gen(function* () {
          const now = yield* nowIso;
          const key = `${content.kind}:${toolUseId}`;
          const nodeId = NodeId.make(`node:claude:${key}`);
          const base = {
            id: PlanId.make(`plan:claude:${key}`),
            threadId: turn.input.threadId,
            runId: turn.input.runId,
            nodeId,
          };
          const plan: OrchestrationV2PlanArtifact =
            content.kind === "proposed_plan"
              ? { ...base, status: "active", kind: "proposed_plan", markdown: content.markdown }
              : {
                  ...base,
                  status: content.steps.every((step) => step.status === "completed")
                    ? "completed"
                    : "active",
                  kind: "todo_list",
                  steps: content.steps,
                };
          const latestKey = `${turn.input.threadId}:${content.kind}`;
          const previous = latestPlans.get(latestKey);
          if (
            previous !== undefined &&
            previous.id !== plan.id &&
            previous.status !== "completed"
          ) {
            yield* publish({ type: "plan.updated", plan: { ...previous, status: "superseded" } });
          }
          latestPlans.set(latestKey, plan);
          yield* publish({
            type: "node.updated",
            node: {
              id: nodeId,
              threadId: turn.input.threadId,
              runId: turn.input.runId,
              parentNodeId: turn.input.rootNodeId,
              rootNodeId: turn.input.rootNodeId,
              kind: content.kind === "proposed_plan" ? "plan" : "todo_list",
              status: "completed",
              providerThreadId: turn.input.providerThread.id,
              providerTurnId: turn.input.providerTurnId,
              startedAt: now,
              completedAt: now,
            },
          });
          yield* publish({ type: "plan.updated", plan });
          const itemBase = {
            id: TurnItemId.make(`item:claude:${key}`),
            threadId: turn.input.threadId,
            runId: turn.input.runId,
            nodeId,
            providerThreadId: turn.input.providerThread.id,
            providerTurnId: turn.input.providerTurnId,
            ordinal: 0,
            status: "completed" as const,
            title: null,
            startedAt: now,
            completedAt: now,
            updatedAt: now,
          };
          yield* publish({
            type: "turn_item.updated",
            turnItem:
              content.kind === "proposed_plan"
                ? {
                    ...itemBase,
                    type: "proposed_plan",
                    planId: plan.id,
                    markdown: content.markdown,
                    streaming: false,
                  }
                : { ...itemBase, type: "todo_list", planId: plan.id, steps: content.steps },
          });
        });

      /**
       * An approval of a tool Claude Code asks about: its kind from the
       * tool, and Claude Code's prompt, else a summary of the call.
       */
      const askForApproval = Effect.fnUntraced(function* (
        turn: ActiveTurn,
        toolName: string,
        toolInput: Record<string, unknown>,
        callbackOptions: Parameters<CanUseTool>[2],
        aborted: Effect.Effect<ProviderApprovalDecision>,
      ) {
        const toolUseId = callbackOptions.toolUseID;
        const requestId = RuntimeRequestId.make(`runtime-request:claude:${toolUseId}`);
        const nodeId = NodeId.make(`node:claude:${toolUseId}:approval`);
        const requestKind = classifyClaudeTool(toolName).requestKind;
        const prompt =
          callbackOptions.title ??
          callbackOptions.description ??
          callbackOptions.decisionReason ??
          summarizeClaudeToolRequest(toolName, toolInput);
        const now = yield* nowIso;
        const decision = yield* Deferred.make<ProviderApprovalDecision>();
        pendingRequests.set(requestId, { type: "approval", turn, decision });
        yield* publish({
          type: "node.updated",
          node: {
            id: nodeId,
            threadId: turn.input.threadId,
            runId: turn.input.runId,
            parentNodeId: NodeId.make(`node:claude:${toolUseId}`),
            rootNodeId: turn.input.rootNodeId,
            kind: "approval_request",
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
            id: TurnItemId.make(`item:claude:${toolUseId}:approval`),
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
            type: "approval_request",
            requestId,
            requestKind,
            prompt,
          },
        });
        yield* publish({
          type: "runtime_request.updated",
          runtimeRequest: {
            id: requestId,
            nodeId,
            providerTurnId: turn.input.providerTurnId,
            kind: requestKind,
            status: "pending",
            responseCapability: { type: "live", providerSessionId: open.providerSessionId },
            createdAt: now,
            resolvedAt: null,
          },
        });
        const decided = yield* Effect.raceFirst(Deferred.await(decision), aborted).pipe(
          Effect.ensuring(Effect.sync(() => pendingRequests.delete(requestId))),
        );
        return permissionResultFromDecision({
          toolName,
          decision: decided,
          toolInput,
          toolUseID: toolUseId,
          ...(callbackOptions.suggestions === undefined
            ? {}
            : { suggestions: callbackOptions.suggestions }),
        });
      });

      /**
       * T3 Code's `canUseToolEffect`: `AskUserQuestion` becomes a user-input
       * request and waits for the answers; any other tool is allowed as it
       * is, unless the mode needs the person's approval
       * (`requiresClaudeApproval`), when it becomes an approval request and
       * waits for the decision. Each request publishes its node, its item,
       * then the request (T3 Code's `buildApprovalRequestArtifacts`). It
       * belongs to the turn running now: a callback is not a frame Claude
       * Code stamps with the prompt. An interrupt aborts the callback's
       * signal, which releases a question and cancels an approval.
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
        const aborted = <A>(value: A) =>
          Effect.callback<A>((resume) => {
            const abort = () => resume(Effect.succeed(value));
            callbackOptions.signal.addEventListener("abort", abort, { once: true });
            if (callbackOptions.signal.aborted) abort();
            return Effect.sync(() => callbackOptions.signal.removeEventListener("abort", abort));
          });
        // The plan Claude proposes is the person's to implement or refine:
        // it is captured, and the call refused so Claude stops there.
        if (toolName === "ExitPlanMode") {
          const markdown = claudeProposedPlan(toolInput);
          if (markdown !== undefined && markdown.length > 0) {
            yield* emitPlan(turn, callbackOptions.toolUseID, { kind: "proposed_plan", markdown });
          }
          return {
            behavior: "deny",
            message: PROPOSED_PLAN_CAPTURED_MESSAGE,
            toolUseID: callbackOptions.toolUseID,
          } satisfies PermissionResult;
        }
        if (toolName !== "AskUserQuestion") {
          if (!requiresClaudeApproval(open.runtimePolicy.runtimeMode)) {
            return {
              behavior: "allow",
              updatedInput: toolInput,
              toolUseID: callbackOptions.toolUseID,
            } satisfies PermissionResult;
          }
          return yield* askForApproval(
            turn,
            toolName,
            toolInput,
            callbackOptions,
            aborted("cancel"),
          );
        }
        const toolUseId = callbackOptions.toolUseID;
        const requestId = RuntimeRequestId.make(`runtime-request:claude:${toolUseId}`);
        const nodeId = NodeId.make(`node:claude:${toolUseId}:question`);
        const now = yield* nowIso;
        const answers = yield* Deferred.make<ProviderUserInputAnswers | undefined>();
        pendingRequests.set(requestId, { type: "user_input", turn, answers });
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
        const given = yield* Effect.raceFirst(Deferred.await(answers), aborted(undefined)).pipe(
          Effect.ensuring(Effect.sync(() => pendingRequests.delete(requestId))),
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
        interactionMode: open.runtimePolicy.interactionMode,
        nativeSessionId,
        resume,
        cwd: open.runtimePolicy.cwd,
        executablePath,
        environment: input.environment,
        canUseTool: (toolName, toolInput, callbackOptions) =>
          runPromise(canUseToolEffect(toolName, toolInput, callbackOptions)),
      });
      const session = yield* runner.open({ options, threadId: open.threadId });
      /**
       * The permission mode Claude Code says it is in (T3 Code's
       * `permissionMode` beside `openedPermissionMode`), from its `init` and
       * `status` messages. Claude Code changes it itself when the person
       * approves an edit for the session (its suggestion is `setMode
       * acceptEdits`), and in plan mode it may leave or re-enter plan mode itself
       * (EnterPlanMode, a refused ExitPlanMode).
       */
      const openedPermissionMode: PermissionMode = options.permissionMode ?? "default";
      let permissionMode = openedPermissionMode;
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
          // A todo list the agent keeps is shown as one, as T3 Code shows `TodoWrite`.
          if (block.name === "TodoWrite") {
            yield* emitPlan(turn, block.id, {
              kind: "todo_list",
              steps: claudeTodoSteps(block.input),
            });
          }
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
          const itemType = classifyClaudeTool(block.name).itemType;
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
          // A lone result also comes structured, as T3 Code reads task tools' results.
          const results = content.filter((block) => block.type === "tool_result");
          const structured: unknown =
            results.length === 1 ? Reflect.get(message, "tool_use_result") : undefined;
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
            if (ended.type === "dynamic_tool" && status === "completed") {
              const tasks = applyClaudeTaskTool(
                taskLists.get(turn.input.threadId) ?? new Map(),
                ended.toolName,
                toolInputValue(ended.input),
                structured ?? block.content,
              );
              if (tasks !== undefined) {
                taskLists.set(turn.input.threadId, tasks);
                yield* emitPlan(turn, `claude-tasks:${turn.input.providerTurnId}`, {
                  kind: "todo_list",
                  steps: claudeTaskSteps(tasks),
                });
              }
            }
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
          yield* releaseRequests(turn);
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
        if (!resultAnswers(result, turn.promptUuids)) return Effect.void;
        // A steer stopped the step it interrupted; the turn goes on with it.
        if (turn.steered && !turn.interrupting && isActiveSteeringAbortResult(result)) {
          return Effect.void;
        }
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
          if (stamp !== undefined) turn.owned = turn.promptUuids.has(stamp);
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
        Stream.tap((message) =>
          Effect.sync(() => {
            if (
              message.type === "system" &&
              (message.subtype === "init" || message.subtype === "status") &&
              message.permissionMode !== undefined
            ) {
              permissionMode = message.permissionMode;
            }
          }),
        ),
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
            // T3 Code's `openQuery`: Claude Code may have left the thread's
            // mode on its own, so it goes back before the next prompt.
            if (permissionMode !== openedPermissionMode) {
              yield* session
                .setPermissionMode(openedPermissionMode)
                .pipe(Effect.mapError(adapterError("start-turn")));
              permissionMode = openedPermissionMode;
            }
            const promptUuid = promptUuidFor(turnInput.providerTurnId);
            yield* Ref.set(activeTurn, {
              input: turnInput,
              promptUuids: new Set([promptUuid]),
              steered: false,
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
        // T3 Code's `steerTurn`: the message goes into the running query
        // with priority `now`, and with a uuid of its own, which the turn
        // takes as one of its prompts.
        steerTurn: ({ providerTurnId, message }) =>
          Effect.gen(function* () {
            const turn = yield* Ref.get(activeTurn);
            if (turn === undefined || turn.input.providerTurnId !== providerTurnId) {
              return yield* adapterError("steer-turn")(
                `Claude provider turn ${providerTurnId} is not the active turn.`,
              );
            }
            const uuid = yield* crypto
              .randomUUIDv4()
              .pipe(Effect.mapError(adapterError("steer-turn")));
            const text = applyClaudePromptEffortPrefix(
              message.text,
              compileClaudeModelSelection(turn.input.modelSelection).promptEffort,
            );
            turn.promptUuids.add(uuid);
            turn.steered = true;
            yield* session
              .offer(makeClaudeUserMessage(text, uuid, "now"))
              .pipe(Effect.mapError(adapterError("steer-turn")));
          }),
        interruptTurn: ({ providerTurnId }) =>
          Effect.gen(function* () {
            const turn = yield* Ref.get(activeTurn);
            if (turn === undefined || turn.input.providerTurnId !== providerTurnId) return;
            turn.interrupting = true;
            const stopped = yield* session.interrupt.pipe(
              // Claude Code aborts a request's callback itself; release it anyway.
              Effect.andThen(releaseRequests(turn)),
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
        respondToRuntimeRequest: ({ requestId, decision, answers }) =>
          Effect.suspend(() => {
            const pending = pendingRequests.get(requestId);
            const refuse = (detail: string) =>
              Effect.fail(adapterError("respond-to-runtime-request")(detail));
            if (pending === undefined) {
              return refuse(`Claude is not waiting on runtime request ${requestId}.`);
            }
            if (pending.type === "user_input") {
              return answers === undefined
                ? refuse(`Claude's question ${requestId} needs answers.`)
                : Deferred.succeed(pending.answers, answers).pipe(Effect.asVoid);
            }
            return decision === undefined
              ? refuse(`Claude's approval ${requestId} needs a decision.`)
              : Deferred.succeed(pending.decision, decision).pipe(Effect.asVoid);
          }),
      };
      return runtime;
    }).pipe(Effect.mapError(adapterError("open-session")));

  return {
    instanceId: input.instanceId,
    driver: "claudeAgent",
    // A query keeps the permission mode it opened with; another mode reopens it.
    capabilities: {
      sessions: { supportsRuntimeModeSwitchInSession: false },
      turns: { supportsQueuedMessages: true, supportsActiveSteering: true },
    },
    openSession,
  } satisfies ProviderAdapterV2;
});

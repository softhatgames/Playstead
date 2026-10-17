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
  ProviderUserInputAnswers,
  RuntimeMode,
} from "@playstead/contracts/orchestrationV2";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import * as CodexClient from "@playstead/effect-codex-app-server/client";
import {
  type CodexAppServerError,
  CodexAppServerRequestError,
} from "@playstead/effect-codex-app-server/errors";
import type * as CodexSchema from "@playstead/effect-codex-app-server/schema";
import {
  INTERRUPT_TERMINAL_TIMEOUT,
  type ProviderAdapterV2,
  ProviderAdapterV2Error,
  type ProviderAdapterV2Event,
  type ProviderAdapterV2SessionRuntime,
  type ProviderAdapterV2TurnInput,
} from "@playstead/provider-core/server/ProviderAdapter";
import type { ProcessEnvironment } from "@playstead/shared/shell";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import { codexClientInfo, spawnCodexAppServer } from "../../provider/CodexProvider.ts";

/**
 * Codex through `codex app-server`, over Playstead's Codex app-server client,
 * following T3 Code's `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`
 * at 2577baf, trimmed to starting turns in Full access.
 *
 * - One app-server per session: `initialize`, then one Codex thread
 *   (`thread/start`) that every turn of the session continues
 *   (`turn/start`).
 * - Full access is `approvalPolicy: "never"` with the `dangerFullAccess`
 *   sandbox on each `turn/start`, as T3 Code's `codexRuntimeModeTurnDefaults`
 *   maps it, so Codex never asks for approval.
 * - Assistant text streams from `item/agentMessage/delta`, one update per
 *   delta (T3 Code coalesces them every 50 ms).
 * - A file Codex adds is a `file_change` item carrying the file's name and
 *   content, which T3 Code's item keeps only as a diff.
 *
 * - An interrupt is `turn/interrupt` (T3 Code's `interruptTurn`), then
 *   `thread/backgroundTerminals/terminate` for each command still running,
 *   which Codex's interrupt leaves running; the turn ends interrupted on
 *   Codex's `turn/completed`, even one that says completed, or after
 *   `INTERRUPT_TERMINAL_TIMEOUT` without one.
 *
 * - Codex's `item/tool/requestUserInput` reaches the person as a user-input
 *   request, as T3 Code's handler routes it, and its answer is the
 *   request's response. Codex 0.163.0 asks only in plan mode, which
 *   Playstead does not run, so this path is proven only by a hand-made
 *   recording. An interrupt stops waiting without answering: Codex drops
 *   the request itself when the turn ends.
 *
 * Absent: resuming a thread after a restart; and, as in the slice as a
 * whole, MCP, plans, reasoning, collaboration modes, subagents, goals,
 * approvals and usage. A server request nobody handles gets "method not
 * found" from the client, so an unexpected approval fails loudly.
 */

const CODEX = "codex" as const;

/** T3 Code's `CODEX_CLIENT_CAPABILITIES` without the MCP app extension. */
const CODEX_CLIENT_CAPABILITIES = {
  experimentalApi: true,
  optOutNotificationMethods: ["turn/diff/updated"],
} as const;

export interface CodexAppServerOpenInput {
  readonly threadId: ThreadId;
  readonly binaryPath: string;
  readonly environment: ProcessEnvironment;
  readonly platform: NodeJS.Platform;
  readonly cwd: string;
}

/**
 * The seam between the adapter and Codex (T3 Code's
 * `CodexAppServerClientFactory`): a client for one session's app-server,
 * open until the scope closes. Production spawns the person's `codex`;
 * Seam 1 tests give a client over a recording, and the recorder taps the
 * real one.
 */
export class CodexAppServerClientFactory extends Context.Service<
  CodexAppServerClientFactory,
  {
    readonly open: (
      input: CodexAppServerOpenInput,
    ) => Effect.Effect<
      CodexClient.CodexAppServerClient["Service"],
      CodexAppServerError,
      Scope.Scope
    >;
  }
>()("@playstead/server/orchestration-v2/Adapters/CodexAdapterV2/CodexAppServerClientFactory") {}

/** The real app-server, spawned as the status check spawns it. */
export const layerAppServerClientFactory: Layer.Layer<
  CodexAppServerClientFactory,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> = Layer.effect(
  CodexAppServerClientFactory,
  Effect.gen(function* () {
    // Only these two: the layer's own scope ends once the adapter is built,
    // and each app-server belongs to its session's scope.
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fileSystem = yield* FileSystem.FileSystem;
    return CodexAppServerClientFactory.of({
      open: (input) =>
        spawnCodexAppServer(input).pipe(
          Effect.flatMap(CodexClient.fromChildProcess),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
        ),
    });
  }),
);

/** T3 Code's `codexRuntimeModeTurnDefaults` for the one mode Playstead runs in. */
const codexTurnPolicyForRuntimeMode = (runtimeMode: RuntimeMode) => {
  switch (runtimeMode) {
    case "full-access":
      return {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "dangerFullAccess" },
      } as const satisfies Pick<
        CodexSchema.V2TurnStartParams,
        "approvalPolicy" | "approvalsReviewer" | "sandboxPolicy"
      >;
  }
};

/** `buildCodexTurnStartParams` at 2577baf, without effort, service tier, summaries or context. */
const buildCodexTurnStartParams = (
  nativeThreadId: string,
  turn: ProviderAdapterV2TurnInput,
): CodexSchema.V2TurnStartParams => ({
  threadId: nativeThreadId,
  input: [{ type: "text", text: turn.message.text }],
  cwd: turn.runtimePolicy.cwd,
  model: turn.modelSelection.model,
  ...codexTurnPolicyForRuntimeMode(turn.runtimePolicy.runtimeMode),
});

type CodexThreadItem = CodexSchema.V2ThreadItem;

/** `codexItemStatus` at 2577baf: a declined change failed. */
const itemStatus = (status: "inProgress" | "completed" | "failed" | "declined") =>
  status === "inProgress" ? "running" : status === "completed" ? "completed" : "failed";

/** The answers by question id, as Codex takes them (T3 Code's `toCodexUserInputAnswers`). */
const toCodexUserInputAnswers = (
  answers: ProviderUserInputAnswers,
  questionIds: ReadonlySet<string>,
): CodexSchema.ToolRequestUserInputResponse["answers"] =>
  Object.fromEntries(
    Object.entries(answers).flatMap(([questionId, answer]) =>
      questionIds.has(questionId)
        ? [[questionId, { answers: typeof answer === "string" ? [answer] : [...answer] }]]
        : [],
    ),
  );

const nonEmpty = (value: string | undefined, fallback: string) =>
  value !== undefined && value.trim().length > 0 ? value.trim() : fallback;

interface ActiveTurn {
  readonly input: ProviderAdapterV2TurnInput;
  /** Codex's id for the turn, once `turn/start` answers or a notification names it. */
  nativeTurnId: string | undefined;
  readonly items: Map<string, OrchestrationV2TurnItem>;
  /** Set once the person asked to stop it (T3 Code's `interruptingNativeTurns`). */
  interrupting: boolean;
  /**
   * The background terminal (`processId`) of each command still running, by
   * item id (T3 Code's `runningCommandItemsByTurn`).
   */
  readonly runningCommands: Map<string, string>;
  readonly ended: Deferred.Deferred<void>;
}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/**
 * One Codex instance's adapter, given its **Binary path** and the server's
 * environment. The client factory comes from the context: production's or
 * a replay.
 */
export const makeCodexAdapter = Effect.fn("makeCodexAdapter")(function* (input: {
  readonly instanceId: ProviderInstanceId;
  readonly binaryPath: string;
  readonly environment: ProcessEnvironment;
  readonly platform: NodeJS.Platform;
  readonly cwd: string;
}): Effect.fn.Return<ProviderAdapterV2, never, CodexAppServerClientFactory> {
  const clients = yield* CodexAppServerClientFactory;

  const adapterError = (operation: ProviderAdapterV2Error["operation"]) => (cause: unknown) =>
    new ProviderAdapterV2Error({
      driver: CODEX,
      operation,
      detail: cause instanceof Error ? cause.message : String(cause),
      cause,
    });

  const openSession: ProviderAdapterV2["openSession"] = (open) =>
    Effect.gen(function* () {
      const client = yield* clients.open({
        threadId: open.threadId,
        binaryPath: input.binaryPath,
        environment: input.environment,
        platform: input.platform,
        cwd: input.cwd,
      });
      const events = yield* PubSub.unbounded<ProviderAdapterV2Event>();
      const live = yield* Ref.make(true);
      const activeTurn = yield* Ref.make<ActiveTurn | undefined>(undefined);
      const nativeThreadId = yield* Ref.make<string | undefined>(undefined);
      const createdAt = yield* nowIso;

      const publish = (event: ProviderAdapterV2Event) => PubSub.publish(events, event);

      /** Questions Codex waits on; `undefined` stops waiting without an answer. */
      const pendingQuestions = new Map<
        RuntimeRequestId,
        {
          readonly turn: ActiveTurn;
          readonly answers: Deferred.Deferred<ProviderUserInputAnswers | undefined>;
        }
      >();
      const releaseQuestions = (turn: ActiveTurn) =>
        Effect.forEach(
          [...pendingQuestions.values()].filter((pending) => pending.turn === turn),
          (pending) => Deferred.succeed(pending.answers, undefined),
          { discard: true },
        );

      // Turns already ended, so a late notification of one is not taken
      // for the next turn's.
      const endedNativeTurns = new Set<string>();

      /** The running turn, if the notification is about it. */
      const turnFor = (nativeTurnId: string) =>
        Effect.map(Ref.get(activeTurn), (turn) => {
          if (turn === undefined || endedNativeTurns.has(nativeTurnId)) return undefined;
          if (turn.nativeTurnId === undefined) turn.nativeTurnId = nativeTurnId;
          return turn.nativeTurnId === nativeTurnId ? turn : undefined;
        });

      const itemBase = (turn: ActiveTurn, nativeItemId: string, now: string) => ({
        id: TurnItemId.make(`item:codex:${nativeItemId}`),
        threadId: turn.input.threadId,
        runId: turn.input.runId,
        nodeId: NodeId.make(`node:codex:${nativeItemId}`),
        providerThreadId: turn.input.providerThread.id,
        providerTurnId: turn.input.providerTurnId,
        ordinal: 0,
        title: null,
        startedAt: now,
        completedAt: null,
        updatedAt: now,
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
          // A node is announced when its item starts and again when it ends.
          if (previous === undefined || item.completedAt !== null) {
            yield* publish({
              type: "node.updated",
              node: {
                id: item.nodeId ?? turn.input.rootNodeId,
                threadId: turn.input.threadId,
                runId: turn.input.runId,
                parentNodeId: turn.input.rootNodeId,
                rootNodeId: turn.input.rootNodeId,
                kind,
                status: item.status,
                providerThreadId: turn.input.providerThread.id,
                providerTurnId: turn.input.providerTurnId,
                startedAt: item.startedAt,
                completedAt: item.completedAt,
              },
            });
          }
          yield* publish({ type: "turn_item.updated", turnItem: item });
        });

      /**
       * A Codex item as a turn item (T3 Code's `buildAgentMessageArtifacts`,
       * `buildFileChangeArtifacts` and `buildCommandExecutionArtifacts`).
       * Other kinds of item are not shown.
       */
      const turnItemFor = (
        turn: ActiveTurn,
        item: CodexThreadItem,
        completed: boolean,
        now: string,
      ):
        | {
            readonly item: OrchestrationV2TurnItem;
            readonly kind: "assistant_message" | "tool_call";
          }
        | undefined => {
        const previous = turn.items.get(item.id);
        const base = {
          ...itemBase(turn, item.id, previous?.startedAt ?? now),
          updatedAt: now,
          completedAt: completed ? now : null,
        };
        switch (item.type) {
          case "agentMessage": {
            const streamed = previous?.type === "assistant_message" ? previous.text : "";
            return {
              kind: "assistant_message",
              item: {
                ...base,
                status: completed ? "completed" : "running",
                type: "assistant_message",
                messageId: MessageId.make(`message:codex:${item.id}`),
                text: completed || item.text.length > 0 ? item.text : streamed,
                streaming: !completed,
              },
            };
          }
          case "fileChange": {
            // T3 Code shows the first change only.
            const change = item.changes[0];
            if (change === undefined) return undefined;
            return {
              kind: "tool_call",
              item: {
                ...base,
                status: itemStatus(item.status),
                type: "file_change",
                fileName: change.path,
                // An added file's diff is its content.
                ...(change.kind.type === "add" ? { newStr: change.diff } : {}),
              },
            };
          }
          case "commandExecution":
            return {
              kind: "tool_call",
              item: {
                ...base,
                status: itemStatus(item.status),
                type: "command_execution",
                input: item.command,
                ...(typeof item.aggregatedOutput === "string"
                  ? { output: item.aggregatedOutput }
                  : {}),
              },
            };
          default:
            return undefined;
        }
      };

      const handleItem = (nativeTurnId: string, item: CodexThreadItem, completed: boolean) =>
        Effect.gen(function* () {
          const turn = yield* turnFor(nativeTurnId);
          if (turn === undefined) return;
          if (item.type === "commandExecution") {
            if (!completed && item.status === "inProgress" && typeof item.processId === "string") {
              turn.runningCommands.set(item.id, item.processId);
            } else {
              turn.runningCommands.delete(item.id);
            }
          }
          const built = turnItemFor(turn, item, completed, yield* nowIso);
          if (built === undefined) return;
          yield* putItem(turn, item.id, built.item, built.kind);
        });

      /**
       * Stops a command's background terminal, which Codex leaves running when
       * it interrupts a turn, and checks it is gone when Codex says it was not
       * running (T3 Code's `terminateBackgroundTerminal`). A command that
       * stays is only logged: the turn ends interrupted all the same.
       */
      const terminateCommand = (threadId: string, processId: string) =>
        Effect.gen(function* () {
          const { terminated } = yield* client.request("thread/backgroundTerminals/terminate", {
            threadId,
            processId,
          });
          if (terminated) return;
          let cursor: string | null = null;
          while (true) {
            const page: CodexSchema.V2ThreadBackgroundTerminalsListResponse = yield* client.request(
              "thread/backgroundTerminals/list",
              cursor === null ? { threadId } : { threadId, cursor },
            );
            if (page.data.some((terminal) => terminal.processId === processId)) {
              return yield* Effect.logWarning(
                "Codex kept a command running after the interrupt.",
              ).pipe(Effect.annotateLogs({ processId }));
            }
            if (page.nextCursor === undefined || page.nextCursor === null) return;
            cursor = page.nextCursor;
          }
        }).pipe(
          Effect.catch((error: CodexAppServerError) =>
            Effect.logWarning("Codex could not stop a command of an interrupted turn.").pipe(
              Effect.annotateLogs({ processId, error: error.message }),
            ),
          ),
        );

      const endTurn = (
        turn: ActiveTurn,
        status: "completed" | "interrupted" | "failed",
        failure: OrchestrationV2ProviderFailure | null,
      ) =>
        Effect.gen(function* () {
          // Ends once: Codex's answer and the interrupt's timeout may race.
          if ((yield* Ref.get(activeTurn)) !== turn) return;
          if (turn.nativeTurnId !== undefined) endedNativeTurns.add(turn.nativeTurnId);
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
            status === "failed"
              ? {
                  type: "turn.terminal",
                  providerTurnId: turn.input.providerTurnId,
                  status: "failed",
                  failure: failure ?? {
                    class: "provider_error",
                    message: "Codex ended the turn with an error.",
                  },
                }
              : {
                  type: "turn.terminal",
                  providerTurnId: turn.input.providerTurnId,
                  status,
                  failure: null,
                },
          );
        });

      yield* client.handleServerNotification("item/started", (payload) =>
        handleItem(payload.turnId, payload.item, false),
      );
      yield* client.handleServerNotification("item/agentMessage/delta", (payload) =>
        Effect.gen(function* () {
          const turn = yield* turnFor(payload.turnId);
          if (turn === undefined) return;
          const now = yield* nowIso;
          const previous = turn.items.get(payload.itemId);
          const text =
            (previous?.type === "assistant_message" ? previous.text : "") + payload.delta;
          yield* putItem(
            turn,
            payload.itemId,
            {
              ...itemBase(turn, payload.itemId, previous?.startedAt ?? now),
              updatedAt: now,
              status: "running",
              type: "assistant_message",
              messageId: MessageId.make(`message:codex:${payload.itemId}`),
              text,
              streaming: true,
            },
            "assistant_message",
          );
        }),
      );
      yield* client.handleServerNotification("item/completed", (payload) =>
        handleItem(payload.turnId, payload.item, true),
      );
      // `mapCodexTurnStatus` and `finalizeCodexTurn` at 2577baf.
      yield* client.handleServerNotification("turn/completed", (payload) =>
        Effect.gen(function* () {
          const turn = yield* turnFor(payload.turn.id);
          if (turn === undefined) return;
          const message = payload.turn.error?.message?.trim();
          switch (payload.turn.status) {
            case "completed":
              return yield* endTurn(turn, turn.interrupting ? "interrupted" : "completed", null);
            case "interrupted":
              return yield* endTurn(turn, "interrupted", null);
            case "failed":
            case "inProgress":
              return yield* endTurn(turn, "failed", {
                class: "provider_error",
                message:
                  message === undefined || message.length === 0
                    ? "Codex ended the turn with an error."
                    : message.slice(0, 4_096),
              });
          }
        }),
      );

      // T3 Code's `item/tool/requestUserInput` handler and
      // `buildUserInputRequestArtifacts`: the question's node, its item, then
      // the request, and the answer once the person gives it.
      yield* client.handleServerRequest("item/tool/requestUserInput", (params) =>
        Effect.gen(function* () {
          const turn = yield* turnFor(params.turnId);
          if (turn === undefined) {
            return yield* CodexAppServerRequestError.internal(
              "item/tool/requestUserInput",
              `No turn is running for the question of turn ${params.turnId}.`,
            );
          }
          const now = yield* nowIso;
          const base = itemBase(turn, params.itemId, now);
          const nodeId = base.nodeId;
          const requestId = RuntimeRequestId.make(`runtime-request:codex:${params.itemId}`);
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
              ...base,
              status: "waiting",
              type: "user_input_request",
              requestId,
              questions: params.questions.map((question, index) => ({
                id: nonEmpty(question.id, `question-${index + 1}`),
                header: nonEmpty(question.header, "Question"),
                question: nonEmpty(question.question, "Choose an answer."),
                options: (question.options ?? []).map((option, optionIndex) => ({
                  label: nonEmpty(option.label, `Option ${optionIndex + 1}`),
                  description: option.description,
                })),
              })),
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
          const given = yield* Deferred.await(answers).pipe(
            Effect.ensuring(Effect.sync(() => pendingQuestions.delete(requestId))),
          );
          // Released: no answer goes back, and Codex drops the request itself.
          if (given === undefined) return yield* Effect.interrupt;
          return {
            answers: toCodexUserInputAnswers(
              given,
              new Set(params.questions.map((question) => question.id)),
            ),
          };
        }),
      );

      // When Codex's output ends the session is gone, and a turn still
      // running fails.
      yield* client.terminated.pipe(
        Effect.flatMap((error) =>
          Effect.gen(function* () {
            yield* Ref.set(live, false);
            const turn = yield* Ref.get(activeTurn);
            if (turn === undefined) return;
            yield* Effect.logWarning("Codex stopped during a turn.").pipe(
              Effect.annotateLogs({ error: error.message }),
            );
            yield* endTurn(turn, "failed", {
              class: "transport_error",
              message: "Codex stopped before the turn finished.",
            });
          }),
        ),
        Effect.forkScoped,
      );

      // `ensureInitialized` at 2577baf; this app-server is the session's own.
      yield* client.request("initialize", {
        clientInfo: codexClientInfo,
        capabilities: CODEX_CLIENT_CAPABILITIES,
      });
      yield* client.notify("initialized", undefined);

      const runtime: ProviderAdapterV2SessionRuntime = {
        driver: CODEX,
        providerSession: {
          id: open.providerSessionId,
          driver: CODEX,
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
        // `codexThreadRuntimeParams` at 2577baf without MCP servers or the plan tool.
        ensureThread: ({ providerThread }) =>
          Effect.gen(function* () {
            const started = yield* Ref.get(nativeThreadId);
            const id =
              started ??
              (yield* client.request("thread/start", {
                cwd: open.runtimePolicy.cwd,
                model: open.modelSelection.model,
              })).thread.id;
            yield* Ref.set(nativeThreadId, id);
            return { ...providerThread, nativeThreadRef: { driver: CODEX, nativeId: id } };
          }).pipe(Effect.mapError(adapterError("ensure-thread"))),
        startTurn: (turnInput) =>
          Effect.gen(function* () {
            if ((yield* Ref.get(activeTurn)) !== undefined) {
              return yield* adapterError("start-turn")("Codex is still running a turn.");
            }
            if (!(yield* Ref.get(live))) {
              return yield* adapterError("start-turn")("Codex is no longer running.");
            }
            const threadId = yield* Ref.get(nativeThreadId);
            if (threadId === undefined) {
              return yield* adapterError("start-turn")("Codex has no thread for this turn.");
            }
            const turn: ActiveTurn = {
              input: turnInput,
              nativeTurnId: undefined,
              items: new Map(),
              interrupting: false,
              runningCommands: new Map(),
              ended: yield* Deferred.make<void>(),
            };
            yield* Ref.set(activeTurn, turn);
            const started = yield* client
              .request("turn/start", buildCodexTurnStartParams(threadId, turnInput))
              .pipe(
                Effect.tapError(() => Ref.set(activeTurn, undefined)),
                Effect.mapError(adapterError("start-turn")),
              );
            turn.nativeTurnId ??= started.turn.id;
          }),
        interruptTurn: ({ providerTurnId }) =>
          Effect.gen(function* () {
            const turn = yield* Ref.get(activeTurn);
            if (turn === undefined || turn.input.providerTurnId !== providerTurnId) return;
            turn.interrupting = true;
            const threadId = yield* Ref.get(nativeThreadId);
            // Before `turn/start` has answered, Codex's id for the turn may
            // not be known; then only the timeout ends it.
            // Codex's interrupt leaves the turn's commands running, so each
            // is stopped too, as T3 Code's `interruptTurn` does.
            const ask =
              threadId === undefined || turn.nativeTurnId === undefined
                ? Effect.void
                : client
                    .request("turn/interrupt", { threadId, turnId: turn.nativeTurnId })
                    .pipe(
                      Effect.andThen(
                        Effect.forEach(
                          [...turn.runningCommands.values()],
                          (processId) => terminateCommand(threadId, processId),
                          { concurrency: "unbounded", discard: true },
                        ),
                      ),
                    );
            const stopped = yield* Effect.all([ask, Deferred.await(turn.ended)], {
              concurrency: "unbounded",
            }).pipe(
              Effect.timeoutOption(INTERRUPT_TERMINAL_TIMEOUT),
              Effect.mapError(adapterError("interrupt-turn")),
              Effect.ensuring(releaseQuestions(turn)),
              Effect.ensuring(
                // Codex never answered: the turn ends here, so the next can start.
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
              yield* Effect.logWarning("Codex did not end an interrupted turn in time.");
            }
          }),
        respondToRuntimeRequest: ({ requestId, answers }) =>
          Effect.suspend(() => {
            const pending = pendingQuestions.get(requestId);
            return pending === undefined
              ? Effect.fail(
                  adapterError("respond-to-runtime-request")(
                    `Codex is not waiting on runtime request ${requestId}.`,
                  ),
                )
              : Deferred.succeed(pending.answers, answers).pipe(Effect.asVoid);
          }),
      };
      return runtime;
    }).pipe(Effect.mapError(adapterError("open-session")));

  return {
    instanceId: input.instanceId,
    driver: CODEX,
    openSession,
  } satisfies ProviderAdapterV2;
});

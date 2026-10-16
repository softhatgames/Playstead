import { MessageId, NodeId, type ThreadId, TurnItemId } from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2ExecutionNode,
  OrchestrationV2ProviderFailure,
  OrchestrationV2TurnItem,
  RuntimeMode,
} from "@playstead/contracts/orchestrationV2";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import * as CodexClient from "@playstead/effect-codex-app-server/client";
import type { CodexAppServerError } from "@playstead/effect-codex-app-server/errors";
import type * as CodexSchema from "@playstead/effect-codex-app-server/schema";
import {
  type ProviderAdapterV2,
  ProviderAdapterV2Error,
  type ProviderAdapterV2Event,
  type ProviderAdapterV2SessionRuntime,
  type ProviderAdapterV2TurnInput,
} from "@playstead/provider-core/server/ProviderAdapter";
import type { ProcessEnvironment } from "@playstead/shared/shell";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
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
 * Absent until their tickets: interrupt (#24), user-input requests (#25),
 * model changes (#23), resuming a thread (#26); and, as in the slice as a
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

interface ActiveTurn {
  readonly input: ProviderAdapterV2TurnInput;
  /** Codex's id for the turn, once `turn/start` answers or a notification names it. */
  nativeTurnId: string | undefined;
  readonly items: Map<string, OrchestrationV2TurnItem>;
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

  const adapterError =
    (operation: "open-session" | "ensure-thread" | "start-turn") => (cause: unknown) =>
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

      /** The running turn, if the notification is about it. */
      const turnFor = (nativeTurnId: string) =>
        Effect.map(Ref.get(activeTurn), (turn) => {
          if (turn === undefined) return undefined;
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
          const built = turnItemFor(turn, item, completed, yield* nowIso);
          if (built === undefined) return;
          yield* putItem(turn, item.id, built.item, built.kind);
        });

      const endTurn = (
        turn: ActiveTurn,
        status: "completed" | "interrupted" | "failed",
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
              return yield* endTurn(turn, "completed", null);
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
      };
      return runtime;
    }).pipe(Effect.mapError(adapterError("open-session")));

  return {
    instanceId: input.instanceId,
    driver: CODEX,
    openSession,
  } satisfies ProviderAdapterV2;
});

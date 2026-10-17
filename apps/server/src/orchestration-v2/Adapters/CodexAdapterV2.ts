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
  ProviderApprovalDecision,
  ProviderRequestKind,
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
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@playstead/shared/model";
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
 * at 2577baf, trimmed to starting, steering, interrupting and answering turns.
 *
 * - One app-server per session: `initialize`, then one Codex thread
 *   (`thread/start`) that every turn of the session continues
 *   (`turn/start`).
 * - Each `turn/start` carries the turn's runtime mode as Codex's approval
 *   policy, approvals reviewer and sandbox (T3 Code's
 *   `codexRuntimeModeTurnDefaults`), so a mode change applies from the next
 *   turn in the same session (`supportsRuntimeModeSwitchInSession`). Full
 *   access never asks; Auto leaves approvals to Codex's own review. Each
 *   `turn/start` also asks for detailed reasoning summaries and carries the
 *   reasoning effort and service tier the person chose, as T3 Code's does.
 * - Assistant text streams from `item/agentMessage/delta`, one update per
 *   delta (T3 Code coalesces them every 50 ms).
 * - A file Codex adds is a `file_change` item carrying the file's name and
 *   content, which T3 Code's item keeps only as a diff.
 *
 * - A steer is `turn/steer` with the running turn's id as `expectedTurnId`
 *   (T3 Code's `steerTurn`); Codex takes the message into that turn.
 * - An interrupt is `turn/interrupt` (T3 Code's `interruptTurn`), then
 *   `thread/backgroundTerminals/terminate` for each command still running,
 *   which Codex's interrupt leaves running; the turn ends interrupted on
 *   Codex's `turn/completed`, even one that says completed, or after
 *   `INTERRUPT_TERMINAL_TIMEOUT` without one.
 *
 * - Codex's `item/tool/requestUserInput` reaches the person as a user-input
 *   request, as T3 Code's handler routes it, and its answer is the
 *   request's response. Codex 0.163.0 asks only in plan mode. An interrupt
 *   stops waiting without answering: Codex drops the request itself when
 *   the turn ends.
 *
 * - Plan mode is Codex's own plan collaboration mode on `turn/start`. Its
 *   proposed plan streams from `item/plan/delta` and ends with the `plan`
 *   item; the plan tool, turned on in `thread/start`, sends the agent's todo
 *   list as `turn/plan/updated`. Codex keeps a thread's collaboration mode
 *   between turns, so after a plan turn every turn names its mode; T3 Code
 *   sends none on a default turn, which can leave Codex planning.
 *
 * - Codex's command, file-change and permissions approvals, and the legacy
 *   `execCommandApproval` and `applyPatchApproval`, reach the person as
 *   approval requests, as T3 Code's handlers route them, and the decision
 *   goes back as T3 Code maps it: `acceptAlways` approves for the session,
 *   and a permissions request is granted for the turn or the session, or
 *   not at all. An interrupt stops waiting without answering, as for a
 *   question.
 * - Approving a command or a file change for the session allows that kind
 *   of request for the rest of the session while the runtime mode stays
 *   the same, as T3 Code's `sessionApprovals` does: the adapter answers
 *   Codex's later requests of that kind itself, without asking. A turn in
 *   another mode starts with nothing allowed.
 *
 * Absent: resuming a thread after a restart; and, as in the slice as a
 * whole, MCP, showing reasoning, subagents, goals and usage. A server
 * request nobody handles gets "method not found" from the client, so an
 * unexpected one fails loudly.
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

/**
 * Each runtime mode's approval policy, approvals reviewer and sandbox, sent
 * on every `turn/start` (T3 Code's `codexRuntimeModeTurnDefaults`). The
 * reviewer is always explicit: left out, Codex keeps the previous turn's,
 * so Auto's review would outlast a change away from Auto.
 */
const codexTurnPolicyForRuntimeMode = (
  runtimeMode: RuntimeMode,
): Required<
  Pick<CodexSchema.V2TurnStartParams, "approvalPolicy" | "approvalsReviewer" | "sandboxPolicy">
> => {
  switch (runtimeMode) {
    case "approval-required":
      return {
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "readOnly" },
      };
    case "auto-accept-edits":
      return {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "workspaceWrite" },
      };
    case "auto":
      return {
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandboxPolicy: { type: "workspaceWrite" },
      };
    case "full-access":
      return {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "dangerFullAccess" },
      };
  }
};

/**
 * The service tier chosen, or `fast` for a fast-mode choice (T3 Code's
 * `getCodexServiceTierOptionValue`, `apps/server/src/codexModelOptions.ts`).
 */
const codexServiceTier = (turn: ProviderAdapterV2TurnInput) =>
  getModelSelectionStringOptionValue(turn.modelSelection, "serviceTier") ??
  (getModelSelectionBooleanOptionValue(turn.modelSelection, "fastMode") === true
    ? "fast"
    : undefined);

/**
 * The collaboration mode a turn starts in (T3 Code's `collaborationMode` in
 * `buildCodexTurnStartParams`, without its MCP's developer instructions):
 * plan mode on a plan turn, with the turn's model and effort (`medium`
 * unless chosen). T3 Code leaves the mode out of a default turn, but Codex
 * keeps a thread's collaboration mode for later turns, so a thread that
 * planned could go on planning; once a session has sent a mode, every
 * later turn sends its own, default included.
 */
const codexCollaborationMode = (
  turn: ProviderAdapterV2TurnInput,
  sentBefore: boolean,
): CodexSchema.V2CollaborationMode | undefined => {
  const mode = turn.runtimePolicy.interactionMode;
  if (mode !== "plan" && !sentBefore) return undefined;
  const effort = getModelSelectionStringOptionValue(turn.modelSelection, "reasoningEffort");
  return {
    mode,
    settings: {
      model: turn.modelSelection.model,
      reasoning_effort: effort ?? "medium",
    },
  };
};

/**
 * `buildCodexTurnStartParams` at 2577baf without context: detailed
 * reasoning summaries on every turn, the reasoning effort and service tier
 * when chosen, which Codex keeps for later turns, and the collaboration
 * mode.
 */
const buildCodexTurnStartParams = (
  nativeThreadId: string,
  turn: ProviderAdapterV2TurnInput,
  collaborationMode: CodexSchema.V2CollaborationMode | undefined,
): CodexSchema.V2TurnStartParams => {
  const effort = getModelSelectionStringOptionValue(turn.modelSelection, "reasoningEffort");
  const serviceTier = codexServiceTier(turn);
  return {
    threadId: nativeThreadId,
    input: [{ type: "text", text: turn.message.text }],
    cwd: turn.runtimePolicy.cwd,
    model: turn.modelSelection.model,
    summary: "detailed",
    ...codexTurnPolicyForRuntimeMode(turn.runtimePolicy.runtimeMode),
    ...(effort === undefined ? {} : { effort }),
    ...(serviceTier === undefined ? {} : { serviceTier }),
    ...(collaborationMode === undefined ? {} : { collaborationMode }),
  };
};

/**
 * The thread settings Playstead starts Codex threads with (T3 Code's
 * `CODEX_THREAD_CONFIG` without its MCP startup grace): Codex's plan tool,
 * whose todo lists the person follows.
 */
const CODEX_THREAD_CONFIG = { "tools.update_plan.enabled": true } as const;

/** `codexPlanStepStatus` at 2577baf. */
const planStepStatus = (
  status: CodexSchema.V2TurnPlanStepStatus,
): OrchestrationV2PlanStep["status"] =>
  status === "completed" ? "completed" : status === "inProgress" ? "running" : "pending";

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

/** The kind of node that carries an item. */
const nodeKindOf = (item: OrchestrationV2TurnItem): OrchestrationV2ExecutionNode["kind"] =>
  item.type === "assistant_message"
    ? "assistant_message"
    : item.type === "proposed_plan"
      ? "plan"
      : item.type === "todo_list"
        ? "todo_list"
        : "tool_call";
/** The decision as a legacy approval takes it (T3 Code's `approvalDecisionToLegacyReviewDecision`). */
const legacyReviewDecision = (decision: ProviderApprovalDecision): CodexSchema.ReviewDecision => {
  switch (decision) {
    case "accept":
      return "approved";
    case "acceptForSession":
    case "acceptAlways":
      return "approved_for_session";
    case "decline":
      return { denied: { rejection: "User declined the request." } };
    case "cancel":
      return "abort";
  }
};

/** `acceptAlways` is Codex's approval for the session (T3 Code's handlers). */
const codexApprovalDecision = (decision: ProviderApprovalDecision) =>
  decision === "acceptAlways" ? "acceptForSession" : decision;

/** What a permissions request asks for (T3 Code's `providerRequestKindFromPermissions`). */
const requestKindFromPermissions = (
  permissions: CodexSchema.PermissionsRequestApprovalParams["permissions"],
): ProviderRequestKind =>
  (permissions.fileSystem?.write?.length ?? 0) > 0
    ? "file-change"
    : (permissions.fileSystem?.read?.length ?? 0) > 0
      ? "file-read"
      : "command";

/** T3 Code's `permissionsResponseFromDecision`: granted for the turn or the session, or nothing. */
const permissionsResponse = (
  decision: ProviderApprovalDecision,
  permissions: CodexSchema.PermissionsRequestApprovalParams["permissions"],
): CodexSchema.PermissionsRequestApprovalResponse =>
  decision === "accept" || decision === "acceptForSession"
    ? { permissions, scope: decision === "acceptForSession" ? "session" : "turn" }
    : { permissions: {}, scope: "turn" };

/**
 * A file change's prompt (T3 Code's `codexFileChangeApprovalPrompt`): Codex's
 * reason, else the changed files in order (at most 20), else the folder it
 * asks to write under.
 */
const fileChangeApprovalPrompt = (input: {
  readonly reason?: string | null;
  readonly grantRoot?: string | null;
  readonly fileChanges?: CodexSchema.ApplyPatchApprovalParams["fileChanges"];
}): string | undefined => {
  const reason = input.reason?.trim();
  if (reason !== undefined && reason.length > 0) return reason;
  const entries = Object.entries(input.fileChanges ?? {}).toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length > 0) {
    const described = entries.slice(0, 20).map(([path, change]) => {
      const movePath = change.type === "update" ? change.move_path : undefined;
      return movePath ? `${change.type} ${path} -> ${movePath}` : `${change.type} ${path}`;
    });
    const remaining = entries.length - described.length;
    return remaining > 0 ? `${described.join("\n")}\n+${remaining} more` : described.join("\n");
  }
  const root = input.grantRoot?.trim();
  return root === undefined || root.length === 0 ? undefined : root;
};

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
      /** Whether a turn of this session has set Codex's collaboration mode. */
      let collaborationModeSent = false;
      const createdAt = yield* nowIso;

      const publish = (event: ProviderAdapterV2Event) => PubSub.publish(events, event);

      /** Requests Codex waits on; `undefined` stops waiting without an answer. */
      const pendingRequests = new Map<
        RuntimeRequestId,
        | {
            readonly type: "user_input";
            readonly turn: ActiveTurn;
            readonly answers: Deferred.Deferred<ProviderUserInputAnswers | undefined>;
          }
        | {
            readonly type: "approval";
            readonly turn: ActiveTurn;
            readonly decision: Deferred.Deferred<ProviderApprovalDecision | undefined>;
          }
      >();
      const releaseRequests = (turn: ActiveTurn) =>
        Effect.forEach(
          [...pendingRequests.values()].filter((pending) => pending.turn === turn),
          (pending) =>
            pending.type === "user_input"
              ? Deferred.succeed(pending.answers, undefined)
              : Deferred.succeed(pending.decision, undefined),
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
          if (item.type === "plan") {
            if (!completed) return;
            const streamed = turn.items.get(item.id);
            return yield* putPlan(turn, item.id, {
              kind: "proposed_plan",
              markdown:
                item.text.length > 0
                  ? item.text
                  : streamed?.type === "proposed_plan"
                    ? streamed.markdown
                    : "",
              completed: true,
            });
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
              ended.type === "assistant_message" || ended.type === "proposed_plan"
                ? { ...ended, streaming: false }
                : ended,
              nodeKindOf(ended),
            );
          }
          yield* Ref.set(activeTurn, undefined);
          yield* releaseRequests(turn);
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

      /**
       * A plan as its node, plan and item (T3 Code's
       * `buildProposedPlanArtifacts` and `buildTodoListArtifacts`). A
       * proposed plan streams until Codex completes its item, and stays
       * active until a message implements it.
       */
      const putPlan = (
        turn: ActiveTurn,
        nativeItemId: string,
        content:
          | {
              readonly kind: "proposed_plan";
              readonly markdown: string;
              readonly completed: boolean;
            }
          | {
              readonly kind: "todo_list";
              readonly steps: ReadonlyArray<OrchestrationV2PlanStep>;
              readonly explanation: string | undefined;
            },
      ) =>
        Effect.gen(function* () {
          const now = yield* nowIso;
          const previous = turn.items.get(nativeItemId);
          const completed = content.kind === "proposed_plan" ? content.completed : false;
          const base = {
            ...itemBase(turn, nativeItemId, previous?.startedAt ?? now),
            updatedAt: now,
            status: completed ? ("completed" as const) : ("running" as const),
            completedAt: completed ? now : null,
          };
          const planId = PlanId.make(`plan:codex:${nativeItemId}`);
          const planBase = {
            id: planId,
            threadId: turn.input.threadId,
            runId: turn.input.runId,
            nodeId: base.nodeId,
            status: "active" as const,
          };
          const explanation =
            content.kind === "todo_list" && content.explanation !== undefined
              ? { explanation: content.explanation }
              : {};
          const plan: OrchestrationV2PlanArtifact =
            content.kind === "proposed_plan"
              ? { ...planBase, kind: "proposed_plan", markdown: content.markdown }
              : { ...planBase, kind: "todo_list", steps: content.steps, ...explanation };
          const item: OrchestrationV2TurnItem =
            content.kind === "proposed_plan"
              ? {
                  ...base,
                  type: "proposed_plan",
                  planId,
                  markdown: content.markdown,
                  streaming: !completed,
                }
              : { ...base, type: "todo_list", planId, steps: content.steps, ...explanation };
          turn.items.set(nativeItemId, item);
          yield* publish({
            type: "node.updated",
            node: {
              id: base.nodeId,
              threadId: turn.input.threadId,
              runId: turn.input.runId,
              parentNodeId: turn.input.rootNodeId,
              rootNodeId: turn.input.rootNodeId,
              kind: content.kind === "proposed_plan" ? "plan" : "todo_list",
              status: item.status,
              providerThreadId: turn.input.providerThread.id,
              providerTurnId: turn.input.providerTurnId,
              startedAt: item.startedAt,
              completedAt: item.completedAt,
            },
          });
          yield* publish({ type: "plan.updated", plan });
          yield* publish({ type: "turn_item.updated", turnItem: item });
        });

      // A proposed plan streams one update per delta, as replies do; T3
      // Code flushes them every 400 ms.
      yield* client.handleServerNotification("item/plan/delta", (payload) =>
        Effect.gen(function* () {
          const turn = yield* turnFor(payload.turnId);
          if (turn === undefined) return;
          const previous = turn.items.get(payload.itemId);
          const markdown =
            (previous?.type === "proposed_plan" ? previous.markdown : "") + payload.delta;
          yield* putPlan(turn, payload.itemId, {
            kind: "proposed_plan",
            markdown,
            completed: false,
          });
        }),
      );
      // The agent's todo list, one per turn (T3 Code's `turn-plan:<turnId>`).
      yield* client.handleServerNotification("turn/plan/updated", (payload) =>
        Effect.gen(function* () {
          const turn = yield* turnFor(payload.turnId);
          if (turn === undefined) return;
          const explanation = payload.explanation?.trim();
          yield* putPlan(turn, `turn-plan:${payload.turnId}`, {
            kind: "todo_list",
            steps: payload.plan.map((step, index) => ({
              id: `step-${index + 1}`,
              text: nonEmpty(step.step, `Step ${index + 1}`),
              status: planStepStatus(step.status),
            })),
            explanation:
              explanation === undefined || explanation.length === 0 ? undefined : explanation,
          });
        }),
      );

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
            Effect.ensuring(Effect.sync(() => pendingRequests.delete(requestId))),
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

      /**
       * T3 Code's `buildApprovalRequestArtifacts` and its wait: the
       * approval's node, its item, then the request, and the person's
       * decision once given. `undefined` when the turn released it.
       */
      const askForApproval = (input: {
        readonly turn: ActiveTurn;
        readonly nativeItemId: string;
        readonly nativeRequestId: string;
        readonly requestKind: ProviderRequestKind;
        readonly prompt: string | null | undefined;
      }) =>
        Effect.gen(function* () {
          const { turn } = input;
          const now = yield* nowIso;
          const requestId = RuntimeRequestId.make(`runtime-request:codex:${input.nativeRequestId}`);
          const nodeId = NodeId.make(`node:codex:${input.nativeRequestId}:approval`);
          const decision = yield* Deferred.make<ProviderApprovalDecision | undefined>();
          pendingRequests.set(requestId, { type: "approval", turn, decision });
          yield* publish({
            type: "node.updated",
            node: {
              id: nodeId,
              threadId: turn.input.threadId,
              runId: turn.input.runId,
              parentNodeId: NodeId.make(`node:codex:${input.nativeItemId}`),
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
              ...itemBase(turn, input.nativeRequestId, now),
              id: TurnItemId.make(`item:codex:${input.nativeRequestId}:approval`),
              nodeId,
              status: "waiting",
              type: "approval_request",
              requestId,
              requestKind: input.requestKind,
              ...(input.prompt === null || input.prompt === undefined
                ? {}
                : { prompt: input.prompt }),
            },
          });
          yield* publish({
            type: "runtime_request.updated",
            runtimeRequest: {
              id: requestId,
              nodeId,
              providerTurnId: turn.input.providerTurnId,
              kind: input.requestKind,
              status: "pending",
              responseCapability: { type: "live", providerSessionId: open.providerSessionId },
              createdAt: now,
              resolvedAt: null,
            },
          });
          const decided = yield* Deferred.await(decision).pipe(
            Effect.ensuring(Effect.sync(() => pendingRequests.delete(requestId))),
          );
          // Released: no answer goes back, and Codex drops the request itself.
          if (decided === undefined) return yield* Effect.interrupt;
          return decided;
        });

      /**
       * The kinds of request the person allowed for the rest of the session
       * (T3 Code's `sessionApprovals`), and the runtime mode they were
       * allowed in. Codex's own `acceptForSession` only skips the exact
       * command or patch it answered, so every new command would ask again.
       * The session has one Codex thread, so T3 Code's key by thread is the
       * session here.
       */
      let sessionApprovals:
        | { readonly runtimeMode: RuntimeMode; readonly kinds: Set<ProviderRequestKind> }
        | undefined;
      /** T3 Code's `endSessionApprovalsOnModeChange`: a turn in another mode starts with none. */
      const endSessionApprovalsOnModeChange = (turn: ProviderAdapterV2TurnInput) => {
        if (sessionApprovals?.runtimeMode !== turn.runtimePolicy.runtimeMode) {
          sessionApprovals = undefined;
        }
      };
      /**
       * T3 Code's `sessionAllowance`: the allowed kinds for a request's turn,
       * read when the request arrives and added to when the person answers,
       * so a late answer from a turn whose mode has since ended is dropped.
       */
      const sessionAllowance = (turn: ActiveTurn): Set<ProviderRequestKind> => {
        const runtimeMode = turn.input.runtimePolicy.runtimeMode;
        if (sessionApprovals?.runtimeMode === runtimeMode) return sessionApprovals.kinds;
        if (sessionApprovals !== undefined) return new Set();
        sessionApprovals = { runtimeMode, kinds: new Set() };
        return sessionApprovals.kinds;
      };
      /**
       * Asks for an approval the session has not allowed yet: `undefined`
       * when it has, else the decision, remembering a session approval.
       */
      const askUnlessAllowed = (input: Parameters<typeof askForApproval>[0]) =>
        Effect.gen(function* () {
          const allowance = sessionAllowance(input.turn);
          if (allowance.has(input.requestKind)) return undefined;
          const decision = yield* askForApproval(input);
          if (decision === "acceptForSession" || decision === "acceptAlways") {
            allowance.add(input.requestKind);
          }
          return decision;
        });

      const noTurn = (method: string, detail: string) =>
        CodexAppServerRequestError.internal(method, `No turn is running for ${detail}.`);

      /** The running turn of this session's Codex thread, for a legacy approval. */
      const turnForThread = (conversationId: string) =>
        Effect.gen(function* () {
          const turn = yield* Ref.get(activeTurn);
          return turn !== undefined && (yield* Ref.get(nativeThreadId)) === conversationId
            ? turn
            : undefined;
        });

      yield* client.handleServerRequest("item/commandExecution/requestApproval", (params) =>
        Effect.gen(function* () {
          const method = "item/commandExecution/requestApproval";
          const turn = yield* turnFor(params.turnId);
          if (turn === undefined) {
            return yield* noTurn(method, `the command approval of turn ${params.turnId}`);
          }
          const decision = yield* askUnlessAllowed({
            turn,
            nativeItemId: params.itemId,
            nativeRequestId: params.approvalId ?? params.itemId,
            requestKind: "command",
            prompt: params.reason ?? params.command,
          });
          return { decision: codexApprovalDecision(decision ?? "acceptForSession") };
        }),
      );
      yield* client.handleServerRequest("item/fileChange/requestApproval", (params) =>
        Effect.gen(function* () {
          const method = "item/fileChange/requestApproval";
          const turn = yield* turnFor(params.turnId);
          if (turn === undefined) {
            return yield* noTurn(method, `the file change approval of turn ${params.turnId}`);
          }
          const decision = yield* askUnlessAllowed({
            turn,
            nativeItemId: params.itemId,
            nativeRequestId: params.itemId,
            requestKind: "file-change",
            prompt: fileChangeApprovalPrompt(params),
          });
          return { decision: codexApprovalDecision(decision ?? "acceptForSession") };
        }),
      );
      yield* client.handleServerRequest("item/permissions/requestApproval", (params) =>
        Effect.gen(function* () {
          const method = "item/permissions/requestApproval";
          const turn = yield* turnFor(params.turnId);
          if (turn === undefined) {
            return yield* noTurn(method, `the permissions approval of turn ${params.turnId}`);
          }
          const decision = yield* askForApproval({
            turn,
            nativeItemId: params.itemId,
            nativeRequestId: params.itemId,
            requestKind: requestKindFromPermissions(params.permissions),
            prompt: params.reason,
          });
          return permissionsResponse(decision, params.permissions);
        }),
      );
      yield* client.handleServerRequest("execCommandApproval", (params) =>
        Effect.gen(function* () {
          const method = "execCommandApproval";
          const turn = yield* turnForThread(params.conversationId);
          if (turn === undefined) {
            return yield* noTurn(method, `the command approval of ${params.conversationId}`);
          }
          const decision = yield* askUnlessAllowed({
            turn,
            nativeItemId: params.callId,
            nativeRequestId: params.approvalId ?? params.callId,
            requestKind: "command",
            prompt: params.reason ?? params.command.join(" "),
          });
          return { decision: legacyReviewDecision(decision ?? "acceptForSession") };
        }),
      );
      yield* client.handleServerRequest("applyPatchApproval", (params) =>
        Effect.gen(function* () {
          const method = "applyPatchApproval";
          const turn = yield* turnForThread(params.conversationId);
          if (turn === undefined) {
            return yield* noTurn(method, `the patch approval of ${params.conversationId}`);
          }
          const decision = yield* askUnlessAllowed({
            turn,
            nativeItemId: params.callId,
            nativeRequestId: params.callId,
            requestKind: "file-change",
            prompt: fileChangeApprovalPrompt(params),
          });
          return { decision: legacyReviewDecision(decision ?? "acceptForSession") };
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
        // `codexThreadRuntimeParams` at 2577baf without MCP servers.
        ensureThread: ({ providerThread }) =>
          Effect.gen(function* () {
            const started = yield* Ref.get(nativeThreadId);
            const id =
              started ??
              (yield* client.request("thread/start", {
                cwd: open.runtimePolicy.cwd,
                model: open.modelSelection.model,
                config: CODEX_THREAD_CONFIG,
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
            endSessionApprovalsOnModeChange(turnInput);
            const turn: ActiveTurn = {
              input: turnInput,
              nativeTurnId: undefined,
              items: new Map(),
              interrupting: false,
              runningCommands: new Map(),
              ended: yield* Deferred.make<void>(),
            };
            yield* Ref.set(activeTurn, turn);
            const collaborationMode = codexCollaborationMode(turnInput, collaborationModeSent);
            const started = yield* client
              .request(
                "turn/start",
                buildCodexTurnStartParams(threadId, turnInput, collaborationMode),
              )
              .pipe(
                Effect.tapError(() => Ref.set(activeTurn, undefined)),
                Effect.mapError(adapterError("start-turn")),
              );
            if (collaborationMode !== undefined) collaborationModeSent = true;
            turn.nativeTurnId ??= started.turn.id;
          }),
        // T3 Code's `steerTurn`: `turn/steer` names the turn Codex must still be running.
        steerTurn: ({ providerTurnId, message }) =>
          Effect.gen(function* () {
            const turn = yield* Ref.get(activeTurn);
            const threadId = yield* Ref.get(nativeThreadId);
            if (
              turn === undefined ||
              turn.input.providerTurnId !== providerTurnId ||
              turn.nativeTurnId === undefined ||
              threadId === undefined
            ) {
              return yield* adapterError("steer-turn")(
                `Provider turn ${providerTurnId} is not active and cannot be steered.`,
              );
            }
            yield* client
              .request("turn/steer", {
                threadId,
                expectedTurnId: turn.nativeTurnId,
                input: [{ type: "text", text: message.text }],
              })
              .pipe(Effect.mapError(adapterError("steer-turn")));
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
              Effect.ensuring(releaseRequests(turn)),
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
        // T3 Code's `respondToRuntimeRequest`: answers for a question, a decision for an approval.
        respondToRuntimeRequest: ({ requestId, decision, answers }) =>
          Effect.suspend(() => {
            const pending = pendingRequests.get(requestId);
            const refuse = (detail: string) =>
              Effect.fail(adapterError("respond-to-runtime-request")(detail));
            if (pending === undefined) {
              return refuse(`Codex is not waiting on runtime request ${requestId}.`);
            }
            if (pending.type === "user_input") {
              return answers === undefined
                ? refuse(`Codex's question ${requestId} needs answers.`)
                : Deferred.succeed(pending.answers, answers).pipe(Effect.asVoid);
            }
            return decision === undefined
              ? refuse(`Codex's approval ${requestId} needs a decision.`)
              : Deferred.succeed(pending.decision, decision).pipe(Effect.asVoid);
          }),
      };
      return runtime;
    }).pipe(Effect.mapError(adapterError("open-session")));

  return {
    instanceId: input.instanceId,
    driver: CODEX,
    capabilities: {
      sessions: { supportsRuntimeModeSwitchInSession: true },
      turns: { supportsQueuedMessages: true, supportsActiveSteering: true },
    },
    openSession,
  } satisfies ProviderAdapterV2;
});

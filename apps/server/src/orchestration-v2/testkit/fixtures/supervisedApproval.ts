import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  type ProviderApprovalDecision,
} from "@playstead/contracts/orchestrationV2";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import type { makeOrchestrationHarness } from "../OrchestratorHarness.ts";

/**
 * Supervised (T3 Code's `tool_call_*` fixtures ask under policy overrides;
 * Playstead asks under the mode): a thread in Supervised is asked to write a
 * file, so the provider asks the person to approve the change. The person
 * answers every approval the turn asks for with one decision, as the
 * approval panel sends it, or presses **Interrupt** at the first one. Each
 * provider's recorder runs it against the signed-in CLI; the replay tests
 * run it again over the recordings.
 */
export interface SupervisedScenario {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly fileName: string;
  readonly content: string;
  readonly prompt: string;
}

/** What the person does with each approval, and the recording that holds it. */
export const SUPERVISED_ANSWERS = {
  approval_accept: "accept",
  approval_decline: "decline",
  approval_cancel: "cancel",
  approval_interrupt: "interrupt",
} as const satisfies Record<string, ProviderApprovalDecision | "interrupt">;
export type SupervisedScenarioName = keyof typeof SUPERVISED_ANSWERS;

export const CLAUDE_SUPERVISED_SCENARIO = {
  instanceId: "claudeAgent",
  model: "claude-haiku-5-5",
  fileName: "supervised-claude.txt",
  content: "written-by-claude-when-approved",
  prompt:
    "Use your Write tool, not the shell, to create supervised-claude.txt in the current folder containing exactly this one word: written-by-claude-when-approved. If you are not allowed to, do not try another way; reply with one short sentence.",
} as const satisfies SupervisedScenario;

export const CODEX_SUPERVISED_SCENARIO = {
  instanceId: "codex",
  model: "gpt-5.6-terra",
  fileName: "supervised-codex.txt",
  content: "Written by Codex when approved.",
  prompt:
    "Use apply_patch, not the shell, to create supervised-codex.txt in the current folder containing exactly this line: Written by Codex when approved. If you are not allowed to, do not try another way; reply with one short sentence.",
} as const satisfies SupervisedScenario;

export const SUPERVISED_IDS = {
  projectId: ProjectId.make("project:supervised"),
  threadId: ThreadId.make("thread:supervised"),
  messageId: MessageId.make("message:supervised:1"),
} as const;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

/** The project, the thread in Supervised and the message; its run is then starting. */
export const sendSupervisedMessage = (harness: Harness, scenario: SupervisedScenario) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(harness.home, "empty-game");
    yield* fs.makeDirectory(folder);
    yield* harness.projects.create({
      commandId: CommandId.make("command:supervised:project"),
      projectId: SUPERVISED_IDS.projectId,
      title: "empty-game",
      workspaceRoot: folder,
    });
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:supervised:thread"),
      threadId: SUPERVISED_IDS.threadId,
      projectId: SUPERVISED_IDS.projectId,
      title: "New thread",
      modelSelection: { instanceId: scenario.instanceId, model: scenario.model },
      runtimeMode: "approval-required",
    });
    const sent = yield* harness.orchestrator.dispatch({
      type: "message.dispatch",
      dispatchMode: { type: "start_immediately" },
      commandId: CommandId.make("command:supervised:message:1"),
      threadId: SUPERVISED_IDS.threadId,
      messageId: SUPERVISED_IDS.messageId,
      text: scenario.prompt,
    });
    yield* harness.worker.drain;
    return { workspace: folder, sent };
  });

/** Waits, without sleeping, for the thread's first pending approval after `afterSequence`. */
export const awaitPendingApproval = (harness: Harness, afterSequence: number) =>
  harness.eventStore.streamApplicationEvents({ afterSequence }).pipe(
    Stream.map((stored) =>
      stored.aggregateKind === "thread" &&
      stored.event.threadId === SUPERVISED_IDS.threadId &&
      stored.event.type === "runtime-request.updated" &&
      stored.event.payload.status === "pending" &&
      stored.event.payload.kind !== "user_input"
        ? stored.event.payload
        : undefined,
    ),
    Stream.filter((request) => request !== undefined),
    Stream.runHead,
    Effect.flatMap((found) =>
      Option.isSome(found)
        ? Effect.succeed(found.value)
        : Effect.die("The event stream ended before an approval was asked."),
    ),
  );

/**
 * Sends the message, then answers each approval the turn asks for with
 * `answer` (or interrupts the run at the first), until the run ends.
 */
export const runSupervisedScenario = (
  harness: Harness,
  scenario: SupervisedScenario,
  answer: ProviderApprovalDecision | "interrupt",
) =>
  Effect.gen(function* () {
    const { workspace, sent } = yield* sendSupervisedMessage(harness, scenario);
    const approvals: Array<OrchestrationV2RuntimeRequest> = [];
    let respond = 0;
    const ended = yield* harness.eventStore
      .streamApplicationEvents({ afterSequence: sent.sequence })
      .pipe(
        Stream.mapEffect((stored) =>
          Effect.gen(function* () {
            if (stored.aggregateKind !== "thread") return undefined;
            const event = stored.event;
            if (event.threadId !== SUPERVISED_IDS.threadId) return undefined;
            if (event.type === "run.updated" && !ACTIVE_RUN_STATUSES.has(event.payload.status)) {
              return event.payload;
            }
            if (
              event.type !== "runtime-request.updated" ||
              event.payload.status !== "pending" ||
              event.payload.kind === "user_input"
            ) {
              return undefined;
            }
            approvals.push(event.payload);
            respond += 1;
            if (answer === "interrupt") {
              if (respond === 1 && event.runId !== undefined) {
                yield* harness.orchestrator.dispatch({
                  type: "run.interrupt",
                  commandId: CommandId.make("command:supervised:interrupt"),
                  threadId: SUPERVISED_IDS.threadId,
                  runId: event.runId,
                });
              }
            } else {
              yield* harness.orchestrator.dispatch({
                type: "runtime-request.respond",
                commandId: CommandId.make(`command:supervised:respond:${respond}`),
                threadId: SUPERVISED_IDS.threadId,
                requestId: event.payload.id,
                decision: answer,
              });
            }
            yield* harness.worker.drain;
            return undefined;
          }),
        ),
        Stream.filter((run): run is OrchestrationV2Run => run !== undefined),
        Stream.runHead,
      );
    if (Option.isNone(ended)) return yield* Effect.die("The event stream ended before the run.");
    return { workspace, approvals, run: ended.value };
  });

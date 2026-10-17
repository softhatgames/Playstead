import {
  CommandId,
  MessageId,
  ProjectId,
  type RunId,
  ThreadId,
} from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2RuntimeRequest,
  OrchestrationV2TurnItem,
} from "@playstead/contracts/orchestrationV2";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import type { makeOrchestrationHarness } from "../OrchestratorHarness.ts";

/**
 * A provider's question (T3 Code has no recording of one outside Codex's
 * plan mode): a thread is asked to put one question to the person and to
 * reply with the answer. The question is answered through
 * `runtime-request.respond`, as the pending user-input panel sends it, or
 * the turn waiting on it is interrupted. Each provider's recorder runs it
 * against the signed-in CLI; the replay tests run it again over the
 * recordings.
 */
export interface QuestionScenario {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly prompt: string;
  /** The option the person picks; the reply holds it. */
  readonly answer: string;
}

export const QUESTION_ANSWER_SCENARIO_NAME = "question_answer";
export const QUESTION_INTERRUPT_SCENARIO_NAME = "question_interrupt";

export const CLAUDE_QUESTION_SCENARIO = {
  instanceId: "claudeAgent",
  model: "claude-haiku-5-5",
  prompt:
    "Use your AskUserQuestion tool to ask me one question: which color I prefer, with the options Red and Blue. Then reply with the single word I chose.",
  answer: "Blue",
} as const satisfies QuestionScenario;

export const CODEX_QUESTION_SCENARIO = {
  instanceId: "codex",
  model: "gpt-5.6-terra",
  prompt:
    "Use your request_user_input tool to ask me one question: which color I prefer, with the options Red and Blue. Then reply with the single word I chose.",
  answer: "Blue",
} as const satisfies QuestionScenario;

export const QUESTION_IDS = {
  projectId: ProjectId.make("project:question"),
  threadId: ThreadId.make("thread:question"),
  messageId: MessageId.make("message:question:1"),
  nextMessageId: MessageId.make("message:question:2"),
} as const;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

/** Sends the message that makes the provider ask; its run is then starting. */
export const sendQuestionMessage = (harness: Harness, scenario: QuestionScenario) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(harness.home, "empty-game");
    yield* fs.makeDirectory(folder);
    yield* harness.projects.create({
      commandId: CommandId.make("command:question:project"),
      projectId: QUESTION_IDS.projectId,
      title: "empty-game",
      workspaceRoot: folder,
    });
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:question:thread"),
      threadId: QUESTION_IDS.threadId,
      projectId: QUESTION_IDS.projectId,
      title: "New thread",
      modelSelection: { instanceId: scenario.instanceId, model: scenario.model },
      runtimeMode: "full-access",
    });
    const sent = yield* harness.orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("command:question:message:1"),
      threadId: QUESTION_IDS.threadId,
      messageId: QUESTION_IDS.messageId,
      text: scenario.prompt,
    });
    yield* harness.worker.drain;
    return { workspace: folder, sent };
  });

export interface PendingQuestion {
  readonly runId: RunId;
  readonly request: OrchestrationV2RuntimeRequest;
  readonly item: Extract<OrchestrationV2TurnItem, { readonly type: "user_input_request" }>;
}

/**
 * Waits, without sleeping, until the thread has a question pending, and
 * returns it with the item the panel shows.
 */
export const awaitPendingQuestion = (harness: Harness, afterSequence: number) =>
  Effect.gen(function* () {
    const found = yield* harness.eventStore.streamApplicationEvents({ afterSequence }).pipe(
      Stream.filter(
        (stored) =>
          stored.aggregateKind === "thread" &&
          stored.event.threadId === QUESTION_IDS.threadId &&
          stored.event.type === "runtime-request.updated" &&
          stored.event.payload.status === "pending",
      ),
      Stream.runHead,
    );
    if (Option.isNone(found) || found.value.aggregateKind !== "thread") {
      return yield* Effect.die("The event stream ended before a question was asked.");
    }
    const event = found.value.event;
    if (event.type !== "runtime-request.updated") return yield* Effect.die("Not a request.");
    const projection = Option.getOrThrow(
      yield* harness.orchestrator.getThreadProjection(QUESTION_IDS.threadId),
    );
    const item = projection.turnItems.find(
      (candidate): candidate is PendingQuestion["item"] =>
        candidate.type === "user_input_request" && candidate.requestId === event.payload.id,
    );
    if (item === undefined || event.runId === undefined) {
      return yield* Effect.die("The question has no item in its run.");
    }
    return { runId: event.runId, request: event.payload, item } satisfies PendingQuestion;
  });

/** The person picks `answer` for every question, as the panel sends it. */
export const answerQuestion = (
  harness: Harness,
  pending: PendingQuestion,
  answer: string,
  attempt = 1,
) =>
  harness.orchestrator.dispatch({
    type: "runtime-request.respond",
    commandId: CommandId.make(`command:question:respond:${attempt}`),
    threadId: QUESTION_IDS.threadId,
    requestId: pending.request.id,
    answers: Object.fromEntries(
      pending.item.questions.map((question) => {
        const option = question.options.find((candidate) =>
          candidate.label.toLowerCase().startsWith(answer.toLowerCase()),
        );
        return [question.id, option?.label ?? answer];
      }),
    ),
  });

/** The provider asks, the person answers, and the run goes on to its end. */
export const runQuestionAnswerScenario = (harness: Harness, scenario: QuestionScenario) =>
  Effect.gen(function* () {
    const { workspace, sent } = yield* sendQuestionMessage(harness, scenario);
    const pending = yield* awaitPendingQuestion(harness, sent.sequence);
    const answered = yield* answerQuestion(harness, pending, scenario.answer);
    yield* harness.worker.drain;
    const run = yield* harness.awaitRunEnded(QUESTION_IDS.threadId, answered.sequence);
    return { workspace, pending, run };
  });

/** The provider asks, and the person presses **Interrupt** instead of answering. */
export const runQuestionInterruptScenario = (harness: Harness, scenario: QuestionScenario) =>
  Effect.gen(function* () {
    const { workspace, sent } = yield* sendQuestionMessage(harness, scenario);
    const pending = yield* awaitPendingQuestion(harness, sent.sequence);
    const interrupted = yield* harness.orchestrator.dispatch({
      type: "run.interrupt",
      commandId: CommandId.make("command:question:interrupt"),
      threadId: QUESTION_IDS.threadId,
      runId: pending.runId,
    });
    yield* harness.worker.drain;
    const run = yield* harness.awaitRunEnded(QUESTION_IDS.threadId, interrupted.sequence);
    return { workspace, pending, run };
  });

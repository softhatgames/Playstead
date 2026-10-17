import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, RuntimeRequestId } from "@playstead/contracts/baseSchemas";
import { OrchestrationDispatchCommandError } from "@playstead/contracts/orchestrationV2";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { makeTestServerConfig } from "../testUtils/testServer.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import { replayClaude, replayProvider } from "./testkit/ProviderReplay.ts";
import {
  answerQuestion,
  awaitPendingQuestion,
  CLAUDE_QUESTION_SCENARIO,
  CODEX_QUESTION_SCENARIO,
  QUESTION_IDS,
  runQuestionAnswerScenario,
  runQuestionInterruptScenario,
  sendQuestionMessage,
} from "./testkit/fixtures/questionAnswer.ts";

const projectionOf = (harness: Effect.Success<ReturnType<typeof makeOrchestrationHarness>>) =>
  Effect.map(harness.orchestrator.getThreadProjection(QUESTION_IDS.threadId), Option.getOrThrow);

const PROVIDERS = [
  { name: "Claude", scenario: CLAUDE_QUESTION_SCENARIO, file: "claude" },
  { name: "Codex", scenario: CODEX_QUESTION_SCENARIO, file: "codex" },
] as const;

describe("Answer a provider's question", () => {
  it.layer(NodeServices.layer)((it) => {
    for (const provider of PROVIDERS) {
      it.effect(
        `${provider.name}: the provider asks, the answer goes through runtime-request.respond, and the run completes`,
        () =>
          Effect.gen(function* () {
            const { harness, assertComplete } = yield* replayProvider(
              provider.file,
              `question_answer.${provider.file}.ndjson`,
            );

            const { pending, run } = yield* runQuestionAnswerScenario(harness, provider.scenario);

            yield* assertComplete;
            // The person saw one question with Red and Blue to pick from.
            assert.strictEqual(pending.request.status, "pending");
            assert.strictEqual(pending.request.kind, "user_input");
            assert.strictEqual(pending.item.status, "waiting");
            assert.strictEqual(pending.item.questions.length, 1);
            const question = pending.item.questions[0]!;
            assert.match(question.question, /colou?r/i);
            assert.deepStrictEqual(
              question.options.map((option) => option.label.replace(/ \(Recommended\)$/, "")),
              ["Red", "Blue"],
            );

            assert.strictEqual(run.status, "completed");
            const projection = yield* projectionOf(harness);
            const request = projection.runtimeRequests.find(
              (candidate) => candidate.id === pending.request.id,
            );
            assert.strictEqual(request?.status, "resolved");
            assert.deepStrictEqual(request?.answers, { [question.id]: "Blue" });
            const item = projection.turnItems.find((candidate) => candidate.id === pending.item.id);
            assert.strictEqual(item?.status, "completed");
            assert.deepStrictEqual(item?.type === "user_input_request" ? item.answers : undefined, {
              [question.id]: "Blue",
            });
            const reply = projection.turnItems.findLast(
              (candidate) => candidate.type === "assistant_message",
            );
            assert.match(reply?.type === "assistant_message" ? reply.text : "", /blue/i);

            // An answered question cannot be answered again.
            const again = yield* Effect.flip(answerQuestion(harness, pending, "Red", 2));
            assert.instanceOf(again, OrchestrationDispatchCommandError);
            assert.strictEqual(again.message, `Runtime request ${pending.request.id} is resolved.`);
          }).pipe(Effect.scoped),
      );

      it.effect(
        `${provider.name}: interrupting a turn waiting on a question ends it interrupted and clears the question`,
        () =>
          Effect.gen(function* () {
            const { harness, assertComplete } = yield* replayProvider(
              provider.file,
              `question_interrupt.${provider.file}.ndjson`,
            );

            const { pending, run } = yield* runQuestionInterruptScenario(
              harness,
              provider.scenario,
            );

            yield* assertComplete;
            assert.strictEqual(run.status, "interrupted");
            const projection = yield* projectionOf(harness);
            assert.deepStrictEqual(
              projection.runtimeRequests.map((request) => [request.id, request.status]),
              [[pending.request.id, "cancelled"]],
            );
            const item = projection.turnItems.find((candidate) => candidate.id === pending.item.id);
            assert.strictEqual(item?.status, "cancelled");
            assert.strictEqual(
              projection.nodes.find((node) => node.id === pending.request.nodeId)?.status,
              "cancelled",
            );
            assert.isTrue(
              projection.turnItems.some(
                (candidate) =>
                  candidate.type === "run_interrupt_result" && candidate.runId === run.id,
              ),
            );

            // The question is gone: it cannot be answered, and the thread takes the next message.
            const late = yield* Effect.flip(answerQuestion(harness, pending, "Blue", 2));
            assert.strictEqual(late.message, `Runtime request ${pending.request.id} is cancelled.`);
            const next = yield* harness.orchestrator.dispatch({
              type: "message.dispatch",
              dispatchMode: { type: "start_immediately" },
              commandId: CommandId.make("command:question:message:2"),
              threadId: QUESTION_IDS.threadId,
              messageId: QUESTION_IDS.nextMessageId,
              text: "Reply with the single word: ready",
            });
            assert.isAbove(next.sequence, 0);
          }).pipe(Effect.scoped),
      );
    }

    it.effect(
      "an answer is refused for a question nobody asked, or that leaves a question unanswered",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* replayClaude("question_answer.claude.ndjson");
          const { sent } = yield* sendQuestionMessage(harness, CLAUDE_QUESTION_SCENARIO);
          const pending = yield* awaitPendingQuestion(harness, sent.sequence);
          const respond = (attempt: string, requestId: RuntimeRequestId, answer: string) =>
            Effect.flip(
              harness.orchestrator.dispatch({
                type: "runtime-request.respond",
                commandId: CommandId.make(`command:question:refused:${attempt}`),
                threadId: QUESTION_IDS.threadId,
                requestId,
                answers: { [pending.item.questions[0]!.id]: answer },
              }),
            );

          const unknown = yield* respond(
            "unknown",
            RuntimeRequestId.make("runtime-request:nothing"),
            "Blue",
          );
          assert.strictEqual(
            unknown.message,
            "Runtime request runtime-request:nothing was not found.",
          );
          const blank = yield* respond("blank", pending.request.id, "  ");
          assert.strictEqual(blank.message, "Answer each question before sending.");
          const projection = yield* projectionOf(harness);
          assert.strictEqual(projection.runtimeRequests[0]?.status, "pending");
        }).pipe(Effect.scoped),
    );

    it.effect(
      "a question pending when the server stops has expired after the restart, and cannot be answered",
      () =>
        Effect.gen(function* () {
          // The first server stops (is left behind) while Claude waits on the answer.
          const config = yield* makeTestServerConfig();
          const first = yield* replayClaude("question_answer.claude.ndjson", {
            harness: { config },
          });
          const { sent } = yield* sendQuestionMessage(first.harness, CLAUDE_QUESTION_SCENARIO);
          const pending = yield* awaitPendingQuestion(first.harness, sent.sequence);

          const { harness } = yield* replayClaude("question_answer.claude.ndjson", {
            harness: { config, recoverOnStartup: true },
          });
          const projection = yield* projectionOf(harness);
          const request = projection.runtimeRequests.find(
            (candidate) => candidate.id === pending.request.id,
          );
          assert.strictEqual(request?.status, "expired");
          assert.strictEqual(request?.responseCapability.type, "not_resumable");
          assert.strictEqual(
            projection.turnItems.find((candidate) => candidate.id === pending.item.id)?.status,
            "cancelled",
          );
          assert.deepStrictEqual(
            projection.runs.map((run) => run.status),
            ["cancelled"],
          );

          const late = yield* Effect.flip(answerQuestion(harness, pending, "Blue", 2));
          assert.strictEqual(late.message, `Runtime request ${pending.request.id} is expired.`);
        }).pipe(Effect.scoped),
    );
  });
});

import type { ProviderSessionId, RunId } from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2Command,
  OrchestrationV2RuntimeRequest,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
} from "@playstead/contracts/orchestrationV2";
import * as Result from "effect/Result";

import {
  reject,
  requireThread,
  type ThreadCommandDecision,
  type ThreadCommandIds,
  type ThreadCommandInput,
  type ThreadCommandResult,
} from "./ThreadCommandDecision.ts";

/**
 * `runtime-request.respond` answers a request still pending and
 * answerable: an approval with a decision, questions once each has an
 * answer; the provider is given them (T3 Code's
 * `dispatchRuntimeRequestRespond`, `apps/server/src/orchestration-v2/Orchestrator.ts`
 * at 2577baf). The effect worker gives the provider the answer through
 * `RunExecutionService.respondToRuntimeRequest`, T3 Code's
 * `RuntimeRequestService.respond`.
 */
export const decideRuntimeRequestRespond = (
  input: ThreadCommandInput<Extract<OrchestrationV2Command, { type: "runtime-request.respond" }>>,
): ThreadCommandResult =>
  Result.gen(function* () {
    const { command, state, ids, now } = input;
    const projection = yield* requireThread(command, state);
    const request = projection.runtimeRequests.find(
      (candidate) => candidate.id === command.requestId,
    );
    if (request === undefined) {
      return yield* reject(command, `Runtime request ${command.requestId} was not found.`);
    }
    if (request.status !== "pending") {
      return yield* reject(command, `Runtime request ${request.id} is ${request.status}.`);
    }
    if (request.responseCapability.type === "not_resumable") {
      return yield* reject(command, request.responseCapability.reason);
    }
    const { providerSessionId } = request.responseCapability;
    const item = projection.turnItems.find(
      (candidate) =>
        (candidate.type === "approval_request" || candidate.type === "user_input_request") &&
        candidate.requestId === request.id,
    );
    if (request.kind === "user_input") {
      if (item?.type !== "user_input_request" || item.runId === null) {
        return yield* reject(
          command,
          `The question for runtime request ${request.id} was not found.`,
        );
      }
      const answers = command.answers;
      if (answers === undefined)
        return yield* reject(command, "Answer each question before sending.");
      const unanswered = item.questions.some((question) => {
        const answer = answers[question.id];
        return typeof answer === "string"
          ? answer.trim().length === 0
          : answer === undefined || answer.length === 0;
      });
      if (unanswered) return yield* reject(command, "Answer each question before sending.");
      return respond(
        projection,
        request,
        item,
        { answers },
        providerSessionId,
        item.runId,
        ids,
        now,
      );
    }
    if (item?.type !== "approval_request" || item.runId === null) {
      return yield* reject(
        command,
        `The approval for runtime request ${request.id} was not found.`,
      );
    }
    if (command.decision === undefined) {
      return yield* reject(command, `Runtime request ${request.id} needs an approval decision.`);
    }
    return respond(
      projection,
      request,
      item,
      { decision: command.decision },
      providerSessionId,
      item.runId,
      ids,
      now,
    );
  });

/**
 * The person answered a request (T3 Code's `dispatchRuntimeRequestRespond`,
 * live answers only): the request is resolved with the decision or the
 * answers, its node and item end, and the provider is given them. A
 * declined or cancelled approval ends its node and item cancelled; anything
 * else completes them.
 */
function respond(
  projection: OrchestrationV2ThreadProjection,
  request: OrchestrationV2RuntimeRequest,
  item: Extract<OrchestrationV2TurnItem, { type: "approval_request" | "user_input_request" }>,
  answer:
    | { readonly decision: ProviderApprovalDecision }
    | { readonly answers: ProviderUserInputAnswers },
  providerSessionId: ProviderSessionId,
  runId: RunId,
  ids: ThreadCommandIds,
  now: string,
): ThreadCommandDecision {
  const base = { threadId: projection.thread.id, runId, occurredAt: now };
  const node = projection.nodes.find((candidate) => candidate.id === request.nodeId);
  const status =
    "decision" in answer && (answer.decision === "decline" || answer.decision === "cancel")
      ? ("cancelled" as const)
      : ("completed" as const);
  const answeredItem: OrchestrationV2TurnItem =
    item.type === "user_input_request" && "answers" in answer
      ? { ...item, answers: answer.answers, status, completedAt: now, updatedAt: now }
      : { ...item, status, completedAt: now, updatedAt: now };
  return {
    events: [
      {
        ...base,
        type: "runtime-request.updated",
        payload: { ...request, status: "resolved", resolvedAt: now, ...answer },
      },
      ...(node === undefined
        ? []
        : [
            {
              ...base,
              type: "node.updated",
              payload: { ...node, status, completedAt: now },
            } as const,
          ]),
      { ...base, type: "turn-item.updated", payload: answeredItem },
    ],
    effects: [
      {
        id: ids.effectId,
        request: {
          type: "runtime-request.respond",
          runId,
          providerSessionId,
          requestId: request.id,
          ...answer,
        },
      },
    ],
  };
}

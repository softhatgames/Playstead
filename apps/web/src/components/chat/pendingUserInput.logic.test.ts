import { assert, describe, it } from "@effect/vitest";
import {
  NodeId,
  ProviderSessionId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
} from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2RuntimeRequest,
  OrchestrationV2TurnItem,
  OrchestrationV2UserInputQuestion,
} from "@playstead/contracts/orchestrationV2";

import {
  buildPendingUserInputAnswers,
  derivePendingUserInputs,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOption,
} from "./pendingUserInput.logic.ts";

const at = "2026-10-17T00:00:00.000Z";
const color: OrchestrationV2UserInputQuestion = {
  id: "color",
  header: "Color",
  question: "Which color do you prefer?",
  options: [
    { label: "Red", description: "Choose red." },
    { label: "Blue", description: "Choose blue." },
  ],
};
const toppings: OrchestrationV2UserInputQuestion = {
  id: "toppings",
  header: "Toppings",
  question: "Which toppings?",
  options: [
    { label: "Cheese", description: "" },
    { label: "Olives", description: "" },
  ],
  multiSelect: true,
};

const request = (
  id: string,
  status: OrchestrationV2RuntimeRequest["status"],
): OrchestrationV2RuntimeRequest => ({
  id: RuntimeRequestId.make(id),
  nodeId: NodeId.make(`node:${id}`),
  providerTurnId: null,
  kind: "user_input",
  status,
  responseCapability: { type: "live", providerSessionId: ProviderSessionId.make("session:1") },
  createdAt: at,
  resolvedAt: null,
});

const questionItem = (
  requestId: string,
  questions: ReadonlyArray<OrchestrationV2UserInputQuestion>,
): OrchestrationV2TurnItem => ({
  id: TurnItemId.make(`item:${requestId}`),
  threadId: ThreadId.make("thread:1"),
  runId: RunId.make("run:1"),
  nodeId: NodeId.make(`node:${requestId}`),
  providerThreadId: null,
  providerTurnId: null,
  ordinal: 2,
  status: "waiting",
  title: null,
  startedAt: at,
  completedAt: null,
  updatedAt: at,
  type: "user_input_request",
  requestId: RuntimeRequestId.make(requestId),
  questions,
});

describe("derivePendingUserInputs", () => {
  it("lists the questions still waiting on the person, with what each asks", () => {
    const pending = derivePendingUserInputs(
      [request("answered", "resolved"), request("waiting", "pending")],
      [questionItem("answered", [color]), questionItem("waiting", [color, toppings])],
    );
    assert.deepStrictEqual(
      pending.map((input) => [input.requestId, input.questions.map((question) => question.id)]),
      [["waiting", ["color", "toppings"]]],
    );
  });

  it("shows nothing once the question was cancelled or expired", () => {
    assert.deepStrictEqual(
      derivePendingUserInputs(
        [request("stopped", "cancelled"), request("restarted", "expired")],
        [questionItem("stopped", [color]), questionItem("restarted", [color])],
      ),
      [],
    );
  });
});

describe("the person's answers", () => {
  it("are an option's label for each question, and can be sent once every question has one", () => {
    const picked = { color: togglePendingUserInputOption(color, undefined, "Blue") };
    assert.deepStrictEqual(buildPendingUserInputAnswers([color], picked), { color: "Blue" });
    assert.strictEqual(buildPendingUserInputAnswers([color, toppings], picked), null);
  });

  it("pick one option for a single choice, and several for a multiple choice", () => {
    const red = togglePendingUserInputOption(color, undefined, "Red");
    assert.deepStrictEqual(
      buildPendingUserInputAnswers([color], {
        color: togglePendingUserInputOption(color, red, "Blue"),
      }),
      { color: "Blue" },
    );

    const cheese = togglePendingUserInputOption(toppings, undefined, "Cheese");
    const both = togglePendingUserInputOption(toppings, cheese, "Olives");
    assert.deepStrictEqual(buildPendingUserInputAnswers([toppings], { toppings: both }), {
      toppings: ["Cheese", "Olives"],
    });
    assert.strictEqual(
      buildPendingUserInputAnswers([toppings], {
        toppings: togglePendingUserInputOption(
          toppings,
          togglePendingUserInputOption(toppings, both, "Olives"),
          "Cheese",
        ),
      }),
      null,
    );
  });

  it("take the person's own words over a picked option, and ignore blank words", () => {
    const red = togglePendingUserInputOption(color, undefined, "Red");
    assert.deepStrictEqual(
      buildPendingUserInputAnswers([color], {
        color: setPendingUserInputCustomAnswer(red, "  Green  "),
      }),
      { color: "Green" },
    );
    assert.strictEqual(
      buildPendingUserInputAnswers([color], {
        color: setPendingUserInputCustomAnswer(undefined, "   "),
      }),
      null,
    );
  });
});

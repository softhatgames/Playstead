import {
  MessageId,
  NodeId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2ConversationMessage,
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
} from "@playstead/contracts/orchestrationV2";
import { describe, expect, it } from "vite-plus/test";

import { deriveThreadQueueWorkflowState, resolveResumableRunId } from "./threadWorkflows.ts";

const AT = "2026-10-17T10:00:00.000Z";

const run = (
  ordinal: number,
  status: OrchestrationV2Run["status"],
  queue?: { readonly queuePosition?: number; readonly queueHeld?: boolean },
): OrchestrationV2Run => ({
  id: RunId.make(`run:${ordinal}`),
  threadId: ThreadId.make("thread:1"),
  ordinal,
  providerInstanceId: "codex",
  modelSelection: { instanceId: "codex", model: "gpt-5.6-terra" },
  providerThreadId: null,
  userMessageId: MessageId.make(`message:${ordinal}`),
  rootNodeId: null,
  activeAttemptId: null,
  status,
  ...queue,
  requestedAt: AT,
  startedAt: null,
  completedAt: null,
});

const message = (ordinal: number, text: string): OrchestrationV2ConversationMessage => ({
  id: MessageId.make(`message:${ordinal}`),
  threadId: ThreadId.make("thread:1"),
  runId: RunId.make(`run:${ordinal}`),
  nodeId: null,
  role: "user",
  text,
  streaming: false,
  createdAt: AT,
  updatedAt: AT,
});

describe("deriveThreadQueueWorkflowState", () => {
  it("lists queued messages in the order they start, after the active run", () => {
    const state = deriveThreadQueueWorkflowState({
      runs: [
        run(1, "running"),
        run(2, "queued", { queuePosition: 2 }),
        run(3, "queued", { queuePosition: 1 }),
      ],
      messages: [message(1, "first"), message(2, "second"), message(3, "third")],
    });

    expect(state.activeRun?.id).toBe("run:1");
    expect(state.queuedRuns.map((queued) => queued.text)).toEqual(["third", "second"]);
    expect(state.isHeld).toBe(false);
  });

  it("lets a queued message steer only a run whose provider turn is running", () => {
    const attempt = RunAttemptId.make("run-attempt:1");
    const active = { ...run(1, "running"), activeAttemptId: attempt };
    const turn = (status: OrchestrationV2ProviderTurn["status"]): OrchestrationV2ProviderTurn => ({
      id: ProviderTurnId.make("provider-turn:1"),
      providerThreadId: ProviderThreadId.make("provider-thread:1"),
      nodeId: NodeId.make("node:1"),
      runAttemptId: attempt,
      ordinal: 1,
      status,
      startedAt: AT,
      completedAt: null,
    });
    const queued = run(2, "queued", { queuePosition: 1 });
    const canPromote = (
      runs: ReadonlyArray<OrchestrationV2Run>,
      providerTurns: ReadonlyArray<OrchestrationV2ProviderTurn>,
    ) =>
      deriveThreadQueueWorkflowState({
        runs,
        messages: [message(1, "first"), message(2, "second")],
        providerTurns,
      }).canPromoteToSteer;

    expect(canPromote([active, queued], [turn("running")])).toBe(true);
    // Still starting, with no turn yet; its turn already over; nothing active.
    expect(canPromote([{ ...active, status: "starting" }, queued], [])).toBe(false);
    expect(canPromote([active, queued], [turn("completed")])).toBe(false);
    expect(canPromote([run(1, "completed"), queued], [turn("completed")])).toBe(false);
  });

  it("says the queue is held while any queued run is", () => {
    const state = deriveThreadQueueWorkflowState({
      runs: [run(1, "interrupted"), run(2, "queued", { queuePosition: 1, queueHeld: true })],
      messages: [message(1, "first"), message(2, "second")],
    });

    expect(state.activeRun).toBeNull();
    expect(state.isHeld).toBe(true);
  });
});

describe("resolveResumableRunId", () => {
  it("resumes the latest run when it was interrupted, however many wait behind it", () => {
    expect(
      resolveResumableRunId({
        runs: [run(1, "interrupted"), run(2, "queued", { queueHeld: true })],
      }),
    ).toBe("run:1");
  });

  it("resumes an interrupted run past queued messages removed before they started", () => {
    expect(
      resolveResumableRunId({
        runs: [
          { ...run(1, "interrupted"), completedAt: AT },
          run(2, "cancelled"),
          run(3, "queued", { queueHeld: true }),
        ],
      }),
    ).toBe("run:1");
  });

  it("resumes the run that ended last, though a later message started ahead of the queue", () => {
    expect(
      resolveResumableRunId({
        runs: [
          { ...run(1, "completed"), startedAt: AT, completedAt: "2026-10-17T10:00:05.000Z" },
          { ...run(2, "interrupted"), startedAt: AT, completedAt: "2026-10-17T10:00:09.000Z" },
          { ...run(3, "completed"), startedAt: AT, completedAt: "2026-10-17T10:00:02.000Z" },
        ],
      }),
    ).toBe("run:2");
  });

  it("has nothing to resume after a run that completed", () => {
    expect(
      resolveResumableRunId({ runs: [run(1, "interrupted"), run(2, "completed")] }),
    ).toBeNull();
  });
});

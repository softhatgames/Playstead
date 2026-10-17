import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
} from "@playstead/contracts/orchestrationV2";

import { applyThreadStreamItem } from "./thread.ts";

const at = "2026-10-17T00:00:00.000Z";
const threadId = ThreadId.make("thread:1");
const runId = RunId.make("run:1");

const projection: OrchestrationV2ThreadProjection = {
  thread: {
    id: threadId,
    projectId: ProjectId.make("project:1"),
    title: "New thread",
    providerInstanceId: "claudeAgent",
    modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    activeProviderThreadId: null,
    createdAt: at,
    updatedAt: at,
  },
  runs: [],
  attempts: [],
  nodes: [],
  providerSessions: [],
  providerThreads: [],
  providerTurns: [],
  messages: [],
  turnItems: [],
  runtimeRequests: [],
  plans: [],
  updatedAt: at,
};

const run = (status: OrchestrationV2Run["status"]): OrchestrationV2Run => ({
  id: runId,
  threadId,
  ordinal: 1,
  providerInstanceId: "claudeAgent",
  modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
  providerThreadId: null,
  userMessageId: MessageId.make("message:1"),
  rootNodeId: null,
  activeAttemptId: null,
  status,
  requestedAt: at,
  startedAt: null,
  completedAt: null,
});

const reply = (ordinal: number, text: string, streaming: boolean): OrchestrationV2TurnItem => ({
  id: TurnItemId.make("item:reply"),
  threadId,
  runId,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  ordinal,
  status: streaming ? "running" : "completed",
  title: null,
  startedAt: at,
  completedAt: streaming ? null : at,
  updatedAt: at,
  type: "assistant_message",
  messageId: MessageId.make("message:reply"),
  text,
  streaming,
});

const event = <E extends object>(sequence: number, body: E) => ({
  kind: "event" as const,
  sequence,
  event: { id: EventId.make(`event:${sequence}`), threadId, occurredAt: at, ...body },
});

describe("applyThreadStreamItem", () => {
  it("follows a run and a streaming reply after the snapshot", () => {
    let state = applyThreadStreamItem(undefined, {
      kind: "snapshot",
      snapshotSequence: 10,
      projection,
    });
    state = applyThreadStreamItem(
      state,
      event(11, { type: "run.created", payload: run("starting") }),
    );
    state = applyThreadStreamItem(
      state,
      event(12, { type: "turn-item.updated", payload: reply(2, "Hel", true) }),
    );
    state = applyThreadStreamItem(
      state,
      event(13, { type: "turn-item.updated", payload: reply(2, "Hello!", false) }),
    );
    state = applyThreadStreamItem(
      state,
      event(14, { type: "run.updated", payload: run("completed") }),
    );

    assert.strictEqual(state?.sequence, 14);
    assert.deepStrictEqual(state?.projection.runs, [run("completed")]);
    assert.deepStrictEqual(state?.projection.turnItems, [reply(2, "Hello!", false)]);
  });

  it("keeps turn items in ordinal order and drops events it already holds", () => {
    let state = applyThreadStreamItem(undefined, {
      kind: "snapshot",
      snapshotSequence: 10,
      projection: { ...projection, turnItems: [reply(3, "later", false)] },
    });
    const first = { ...reply(1, "first", false), id: TurnItemId.make("item:first") };
    state = applyThreadStreamItem(state, event(11, { type: "turn-item.updated", payload: first }));
    state = applyThreadStreamItem(
      state,
      event(9, {
        type: "thread.metadata-updated",
        payload: { ...projection.thread, title: "Old" },
      }),
    );

    assert.deepStrictEqual(
      state?.projection.turnItems.map((item) => item.ordinal),
      [1, 3],
    );
    assert.strictEqual(state?.projection.thread.title, "New thread");
  });
});

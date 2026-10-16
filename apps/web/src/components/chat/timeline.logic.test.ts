import { assert, describe, it } from "@effect/vitest";
import { MessageId, ThreadId, TurnItemId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2TurnItem } from "@playstead/contracts/orchestrationV2";

import { deriveTimelineRows } from "./timeline.logic.ts";

const at = "2026-10-17T00:00:00.000Z";
const base = (id: string, ordinal: number, status: OrchestrationV2TurnItem["status"]) => ({
  id: TurnItemId.make(id),
  threadId: ThreadId.make("thread:1"),
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  ordinal,
  status,
  title: null,
  startedAt: at,
  completedAt: status === "running" ? null : at,
  updatedAt: at,
});

describe("deriveTimelineRows", () => {
  it("shows messages and a file write as an activity row named relative to the project", () => {
    const rows = deriveTimelineRows(
      [
        {
          ...base("item:user", 1, "completed"),
          type: "user_message",
          messageId: MessageId.make("message:user"),
          text: "Make hello-claude.txt",
        },
        {
          ...base("item:write", 2, "completed"),
          type: "file_change",
          fileName: "/games/empty/hello-claude.txt",
          newStr: "Hello from Claude in Playstead!\n",
        },
        {
          ...base("item:reply", 3, "running"),
          type: "assistant_message",
          messageId: MessageId.make("message:reply"),
          text: "Created it",
          streaming: true,
        },
      ],
      "/games/empty",
    );

    assert.deepStrictEqual(rows, [
      { kind: "user", id: "item:user", text: "Make hello-claude.txt" },
      {
        kind: "work",
        id: "item:write",
        label: "Changed hello-claude.txt",
        detail: "Hello from Claude in Playstead!\n",
        icon: "file",
        tone: "tool",
        running: false,
      },
      { kind: "assistant", id: "item:reply", text: "Created it", streaming: true },
    ]);
  });

  it("names running and failed work as T3 Code does", () => {
    const rows = deriveTimelineRows(
      [
        {
          ...base("item:write", 1, "running"),
          type: "file_change",
          fileName: "/elsewhere/notes.txt",
        },
        {
          ...base("item:run", 2, "failed"),
          type: "command_execution",
          input: "ls -la",
          output: "No such file",
        },
        {
          ...base("item:read", 3, "completed"),
          type: "dynamic_tool",
          toolName: "Read",
          input: {},
        },
        {
          ...base("item:error", 4, "failed"),
          type: "error",
          failure: { class: "provider_error", message: "Claude ran out of turns." },
        },
      ],
      "/games/empty",
    );

    assert.deepStrictEqual(
      rows.map((row) => (row.kind === "work" ? [row.label, row.tone, row.running] : row.kind)),
      [
        ["Changing /elsewhere/notes.txt", "tool", true],
        ["Failed ls -la", "error", false],
        ["Read", "tool", false],
        ["Claude ran out of turns.", "error", false],
      ],
    );
  });

  it("shows an interrupt as T3 Code does: the request, the stopped work, then the run interrupted", () => {
    const rows = deriveTimelineRows(
      [
        {
          ...base("item:run", 1, "interrupted"),
          type: "command_execution",
          input: "sleep 30",
        },
        {
          ...base("item:request", 2, "completed"),
          type: "run_interrupt_request",
          message: "Interrupt requested",
        },
        {
          ...base("item:result", 3, "interrupted"),
          type: "run_interrupt_result",
          message: "Run interrupted by the person",
          parentItemId: TurnItemId.make("item:request"),
        },
      ],
      "/games/empty",
    );

    assert.deepStrictEqual(rows, [
      {
        kind: "work",
        id: "item:run",
        label: "Stopped sleep 30",
        icon: "tool",
        tone: "tool",
        running: false,
      },
      { kind: "interrupt-request", id: "item:request", label: "Interrupt requested" },
      { kind: "interrupted", id: "item:result", label: "Interrupted" },
    ]);
  });
});

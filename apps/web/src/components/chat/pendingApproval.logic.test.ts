import { assert, describe, it } from "@effect/vitest";
import {
  NodeId,
  ProviderSessionId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
} from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2RuntimeRequest,
  OrchestrationV2TurnItem,
} from "@playstead/contracts/orchestrationV2";

import {
  approvalDetail,
  approvalHeading,
  derivePendingApprovals,
  splitApprovalOptions,
} from "./pendingApproval.logic.ts";

const at = "2026-10-17T00:00:00.000Z";

const request = (
  id: string,
  kind: OrchestrationV2RuntimeRequest["kind"],
  status: OrchestrationV2RuntimeRequest["status"] = "pending",
  live = true,
): OrchestrationV2RuntimeRequest => ({
  id: RuntimeRequestId.make(id),
  nodeId: NodeId.make(`node:${id}`),
  providerTurnId: null,
  kind,
  status,
  responseCapability: live
    ? { type: "live", providerSessionId: ProviderSessionId.make("session:1") }
    : { type: "not_resumable", reason: "The server restarted." },
  createdAt: at,
  resolvedAt: null,
});

const approvalItem = (requestId: string, prompt?: string): OrchestrationV2TurnItem => ({
  id: TurnItemId.make(`item:${requestId}`),
  threadId: ThreadId.make("thread:1"),
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  ordinal: 1,
  status: "waiting",
  title: null,
  startedAt: at,
  completedAt: null,
  updatedAt: at,
  type: "approval_request",
  requestId: RuntimeRequestId.make(requestId),
  requestKind: "command",
  ...(prompt === undefined ? {} : { prompt }),
});

describe("derivePendingApprovals", () => {
  it("lists the approvals still waiting, oldest first, with the provider's prompt", () => {
    const approvals = derivePendingApprovals(
      [
        request("approval:1", "command"),
        request("question:1", "user_input"),
        request("approval:2", "file-change", "resolved"),
        request("approval:3", "file-read"),
      ],
      [approvalItem("approval:1", "npm test"), approvalItem("approval:3")],
    );

    assert.deepStrictEqual(approvals, [
      {
        requestId: RuntimeRequestId.make("approval:1"),
        requestKind: "command",
        detail: "npm test",
        responseCapability: "live",
      },
      {
        requestId: RuntimeRequestId.make("approval:3"),
        requestKind: "file-read",
        responseCapability: "live",
      },
    ]);
  });

  it("marks an approval whose provider is gone as not answerable", () => {
    const [approval] = derivePendingApprovals(
      [request("approval:1", "command", "pending", false)],
      [],
    );
    assert.strictEqual(approval?.responseCapability, "not_resumable");
    assert.strictEqual(
      approvalDetail(approval!),
      "Provider process is gone — interrupt or restart the run to respond.",
    );
  });
});

describe("the approval panel", () => {
  it("names each kind of approval as T3 Code does", () => {
    assert.deepStrictEqual(
      (["command", "file-read", "file-change", "permission", "mcp-elicitation"] as const).map(
        approvalHeading,
      ),
      [
        "Command approval",
        "File read approval",
        "File change approval",
        "App permission approval",
        "App access approval",
      ],
    );
  });

  it("shows the prompt, or the kind of approval when there is none", () => {
    const base = {
      requestId: RuntimeRequestId.make("approval:1"),
      responseCapability: "live",
    } as const;
    assert.strictEqual(
      approvalDetail({ ...base, requestKind: "command", detail: "npm test" }),
      "npm test",
    );
    assert.strictEqual(
      approvalDetail({ ...base, requestKind: "file-change", detail: "" }),
      "File change approval",
    );
  });

  it("keeps Approve and Decline as buttons, and Cancel and Always allow this session in the menu", () => {
    const { primary, more } = splitApprovalOptions(undefined);
    assert.deepStrictEqual(
      primary.map((option) => option.label),
      ["Decline", "Approve"],
    );
    assert.deepStrictEqual(
      more.map((option) => option.label),
      ["Cancel", "Always allow this session"],
    );
    assert.strictEqual(more[1]?.decision, "acceptForSession");
  });

  it("uses the provider's own labels when it gives options", () => {
    const { primary, more } = splitApprovalOptions([
      { decision: "accept", label: "Allow once" },
      { decision: "decline", label: "Deny" },
      { decision: "acceptAlways", label: "Always allow Safari" },
    ]);
    assert.deepStrictEqual(
      primary.map((option) => option.label),
      ["Allow once", "Deny"],
    );
    assert.deepStrictEqual(
      more.map((option) => option.label),
      ["Always allow Safari"],
    );
  });
});

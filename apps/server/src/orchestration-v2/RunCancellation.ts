import type { OrchestrationV2ThreadProjection } from "@playstead/contracts/orchestrationV2";
import type { NewDomainEvent } from "./EventSink.ts";

/** Expand cancellation for caller-selected runs; eligibility and cleanup stay with the caller. */
export function cancelRunEvents(
  projection: OrchestrationV2ThreadProjection,
  runs: OrchestrationV2ThreadProjection["runs"],
  now: string,
): Array<NewDomainEvent> {
  const threadId = projection.thread.id;
  const events: Array<NewDomainEvent> = [];
  const runIds = new Set(runs.map((run) => run.id));
  for (const run of runs) {
    events.push({
      type: "run.updated",
      threadId,
      runId: run.id,
      occurredAt: now,
      payload: { ...run, status: "cancelled", completedAt: now },
    });
  }
  for (const attempt of projection.attempts) {
    if (!runIds.has(attempt.runId)) continue;
    if (attempt.status !== "pending" && attempt.status !== "running") continue;
    events.push({
      type: "run-attempt.updated",
      threadId,
      runId: attempt.runId,
      occurredAt: now,
      payload: { ...attempt, status: "cancelled", completedAt: now },
    });
  }
  for (const node of projection.nodes) {
    if (
      node.runId === null ||
      !runIds.has(node.runId) ||
      !["pending", "running", "waiting"].includes(node.status)
    ) {
      continue;
    }
    events.push({
      type: "node.updated",
      threadId,
      runId: node.runId,
      occurredAt: now,
      payload: { ...node, status: "cancelled", completedAt: now },
    });
  }
  return events;
}

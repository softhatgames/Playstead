import type {
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
} from "@playstead/contracts/orchestrationV2";
import type { NewDomainEvent } from "./EventSink.ts";

/** Expand the caller's chosen runs into cancellation events, clearing queued positions. */
export function cancelRuns(
  projection: OrchestrationV2ThreadProjection,
  runs: ReadonlyArray<OrchestrationV2Run>,
  now: string,
): ReadonlyArray<NewDomainEvent> {
  const threadId = projection.thread.id;
  const runIds = new Set(runs.map((run) => run.id));
  const events: Array<NewDomainEvent> = runs.map((run) => ({
    type: "run.updated",
    threadId,
    runId: run.id,
    occurredAt: now,
    payload: { ...run, status: "cancelled", queuePosition: null, completedAt: now },
  }));
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
    if (node.runId === null || !runIds.has(node.runId)) continue;
    if (node.status !== "pending" && node.status !== "running" && node.status !== "waiting") {
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

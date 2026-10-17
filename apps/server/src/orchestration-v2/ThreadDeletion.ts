import { cancelRunEvents } from "./RunCancellation.ts";
import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
  QUEUED_RUN_STATUSES,
} from "@playstead/contracts/orchestrationV2";

import { PROCESS_BOUND_EFFECT_TYPES } from "./EffectOutbox.ts";
import type { NewDomainEvent } from "./EventSink.ts";
import { detachProviderSessions } from "./ProviderSessionDetach.ts";
import type { ThreadCommandDecision } from "./ThreadCommands.ts";

/**
 * A thread's deletion (T3 Code's `planThreadDeletion`,
 * `apps/server/src/orchestration-v2/ThreadDeletion.ts` at 2577baf). It is a
 * soft delete: the thread keeps its row with `deletedAt`, an earlier one
 * kept. Every active or queued run is
 * cancelled with its unfinished attempts and nodes; each run's own event
 * comes first, as T3 Code writes them, so nothing reads the run active
 * again. A question still pending is cancelled and can no longer be
 * answered. Each live provider session is detached and stopped, and the
 * effects the thread still had waiting are cancelled. There are no
 * terminals, previews, attachments or subagents to clean up.
 */
export function planThreadDeletion(input: {
  readonly command: Extract<OrchestrationV2Command, { readonly type: "thread.delete" }>;
  readonly projection: OrchestrationV2ThreadProjection;
  readonly now: string;
}): ThreadCommandDecision {
  const { command, projection, now } = input;
  const threadId = projection.thread.id;
  const events: Array<NewDomainEvent> = [
    {
      type: "thread.deleted",
      threadId,
      occurredAt: now,
      payload: {
        ...projection.thread,
        deletedAt: projection.thread.deletedAt ?? now,
        titleRegeneration: null,
        updatedAt: now,
      },
    },
  ];

  const activeRuns = projection.runs.filter(
    (run) => ACTIVE_RUN_STATUSES.has(run.status) || QUEUED_RUN_STATUSES.has(run.status),
  );
  events.push(...cancelRunEvents(projection, activeRuns, now));
  for (const request of projection.runtimeRequests) {
    if (request.status !== "pending") continue;
    const runId = projection.nodes.find((node) => node.id === request.nodeId)?.runId ?? null;
    events.push({
      type: "runtime-request.updated",
      threadId,
      ...(runId === null ? {} : { runId }),
      occurredAt: now,
      payload: {
        ...request,
        status: "cancelled",
        responseCapability: { type: "not_resumable", reason: "The thread was deleted." },
        resolvedAt: now,
      },
    });
  }

  const detached = detachProviderSessions({
    projection,
    commandId: command.commandId,
    reason: "Thread deleted.",
    now,
  });
  return {
    events: [...events, ...detached.events],
    effects: detached.effects,
    cancelUnsettledEffects: {
      reason: "The thread was deleted.",
      effectTypes: [...PROCESS_BOUND_EFFECT_TYPES, "thread-title.generate"],
    },
  };
}

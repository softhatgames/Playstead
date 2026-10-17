import type { CommandId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2ThreadProjection } from "@playstead/contracts/orchestrationV2";

import type { PendingEffect } from "./EffectOutbox.ts";
import type { NewDomainEvent } from "./EventSink.ts";

/**
 * Detaches every live provider session of a thread (T3 Code's
 * `provider-session.detached` events and `provider-session.detach` effects in
 * `Orchestrator.ts` `dispatchThreadMutation` and `ThreadDeletion.ts` at
 * 2577baf). The projection records each session stopped at once, so nothing
 * reads it live; the effect stops the provider's session itself. Playstead
 * writes the stop as `provider-session.updated`, the event its projection
 * and recovery already read, rather than T3 Code's separate `detached` event.
 * Each effect's id comes from the command's, so a retried command queues it once.
 */
export function detachProviderSessions(input: {
  readonly projection: OrchestrationV2ThreadProjection;
  readonly commandId: CommandId;
  readonly reason: string;
  readonly now: string;
}): {
  readonly events: ReadonlyArray<NewDomainEvent>;
  readonly effects: ReadonlyArray<PendingEffect>;
} {
  const { projection, commandId, reason, now } = input;
  const live = projection.providerSessions.filter(
    (session) => session.status !== "stopped" && session.status !== "error",
  );
  return {
    events: live.map((session) => ({
      type: "provider-session.updated",
      threadId: projection.thread.id,
      occurredAt: now,
      payload: { ...session, status: "stopped", updatedAt: now },
    })),
    effects: live.map((session) => ({
      id: `effect:${commandId}:provider-session.detach:${session.id}`,
      request: { type: "provider-session.detach", providerSessionId: session.id, detail: reason },
    })),
  };
}

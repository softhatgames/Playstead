import type {
  OrchestrationV2DomainEvent,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadStreamItem,
} from "@playstead/contracts/orchestrationV2";

/** One thread as the thread view holds it: its projection and the last event folded in. */
export interface ThreadState {
  readonly sequence: number;
  readonly projection: OrchestrationV2ThreadProjection;
}

const upsertById = <T extends { readonly id: string }>(list: ReadonlyArray<T>, next: T) =>
  list.some((item) => item.id === next.id)
    ? list.map((item) => (item.id === next.id ? next : item))
    : [...list, next];

const applyEvent = (
  projection: OrchestrationV2ThreadProjection,
  event: OrchestrationV2DomainEvent,
): OrchestrationV2ThreadProjection => {
  switch (event.type) {
    case "thread.created":
    case "thread.metadata-updated":
    case "thread.model-selection-updated":
      return { ...projection, thread: event.payload, updatedAt: event.payload.updatedAt };
    case "run.created":
    case "run.updated":
      return { ...projection, runs: upsertById(projection.runs, event.payload) };
    case "run-attempt.created":
    case "run-attempt.updated":
      return { ...projection, attempts: upsertById(projection.attempts, event.payload) };
    case "node.updated":
      return { ...projection, nodes: upsertById(projection.nodes, event.payload) };
    case "provider-session.updated":
      return {
        ...projection,
        providerSessions: upsertById(projection.providerSessions, event.payload),
      };
    case "provider-thread.updated":
      return {
        ...projection,
        providerThreads: upsertById(projection.providerThreads, event.payload),
      };
    case "provider-turn.updated":
      return { ...projection, providerTurns: upsertById(projection.providerTurns, event.payload) };
    case "message.updated":
      return { ...projection, messages: upsertById(projection.messages, event.payload) };
    case "turn-item.updated":
      return {
        ...projection,
        turnItems: [...upsertById(projection.turnItems, event.payload)].sort(
          (left, right) => left.ordinal - right.ordinal,
        ),
      };
    case "runtime-request.updated":
      return {
        ...projection,
        runtimeRequests: upsertById(projection.runtimeRequests, event.payload),
      };
  }
};

/**
 * Folds the thread stream into the thread view's state, after T3 Code's
 * thread store (`packages/client-runtime/src/state/threads.ts` at 2577baf):
 * a snapshot replaces it, and each newer event updates the record it carries.
 * An event at or below the held sequence is old and dropped.
 */
export const applyThreadStreamItem = (
  state: ThreadState | undefined,
  item: OrchestrationV2ThreadStreamItem,
): ThreadState | undefined => {
  if (item.kind === "snapshot") {
    return { sequence: item.snapshotSequence, projection: item.projection };
  }
  if (state === undefined || item.sequence <= state.sequence) return state;
  return { sequence: item.sequence, projection: applyEvent(state.projection, item.event) };
};

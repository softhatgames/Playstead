import { assert } from "@effect/vitest";
import type { ThreadId } from "@playstead/contracts/baseSchemas";
import { OrchestrationDispatchCommandError } from "@playstead/contracts/orchestrationV2";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { makeOrchestrationHarness } from "./OrchestratorHarness.ts";

type Orchestrator = Pick<
  Effect.Success<ReturnType<typeof makeOrchestrationHarness>>,
  "orchestrator"
>;

/** The thread's projection at Seam 1, which must exist. */
export const projectionOf = (harness: Orchestrator, threadId: ThreadId) =>
  Effect.map(harness.orchestrator.getThreadProjection(threadId), Option.getOrThrow);

/** The thread itself from its projection, which must exist. */
export const threadOf = (harness: Orchestrator, threadId: ThreadId) =>
  Effect.map(projectionOf(harness, threadId), (projection) => projection.thread);

/** The message of the command's refusal; the command must be refused. */
export const refusal = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.flip(effect), (error) => {
    assert.instanceOf(error, OrchestrationDispatchCommandError);
    return (error as OrchestrationDispatchCommandError).message;
  });

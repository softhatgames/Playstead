import * as Schema from "effect/Schema";

import { NonNegativeInt } from "./baseSchemas.ts";
import { OrchestrationProjectShell } from "./orchestrationProject.ts";

/**
 * Orchestration v2's contract, after T3 Code's
 * `packages/contracts/src/orchestrationV2.ts` at 2577baf. So far it has the
 * sidebar's shell with projects only; threads, commands and the thread stream
 * join with the orchestration core.
 */

export const ORCHESTRATION_V2_WS_METHODS = {
  subscribeShell: "orchestration.subscribeShell",
} as const;

export const OrchestrationV2ShellSnapshot = Schema.Struct({
  /** The last application event the snapshot includes. */
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
});
export type OrchestrationV2ShellSnapshot = typeof OrchestrationV2ShellSnapshot.Type;

/** The snapshot first, then each change after it. */
export const OrchestrationV2ShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationV2ShellSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("project.updated"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
]);
export type OrchestrationV2ShellStreamItem = typeof OrchestrationV2ShellStreamItem.Type;

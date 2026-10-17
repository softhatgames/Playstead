import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2PlanArtifact } from "@playstead/contracts/orchestrationV2";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import type { makeOrchestrationHarness } from "../OrchestratorHarness.ts";

/**
 * Plan mode, then **Implement** (T3 Code's `proposed_plan` fixture, with the
 * implementation T3 Code tests only in its interface): a thread in plan mode
 * is asked for a plan to write a file, and the provider proposes one without
 * writing anything; then the interface's **Implement** sends the thread back
 * to the default mode and the plan as the next message, naming the plan it
 * implements, and the provider writes the file. Each provider's recorder
 * runs it against the signed-in CLI; the replay tests run it again over the
 * recordings, which hold the modes the adapter sent.
 */
export interface ProposedPlanScenario {
  readonly scenario: string;
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly fileName: string;
  readonly content: string;
  readonly planPrompt: string;
}

export const PROPOSED_PLAN_SCENARIO_NAME = "proposed_plan";

export const CLAUDE_PROPOSED_PLAN_SCENARIO = {
  scenario: PROPOSED_PLAN_SCENARIO_NAME,
  instanceId: "claudeAgent",
  model: "claude-haiku-5-5",
  fileName: "planned-claude.txt",
  content: "planned-by-claude",
  planPrompt:
    "Make a plan, in two short steps, to create planned-claude.txt in the current folder containing exactly this one word: planned-by-claude. The plan must say to use the Write tool, not the shell. Do not ask me any questions. Present the plan with your ExitPlanMode tool.",
} as const satisfies ProposedPlanScenario;

export const CODEX_PROPOSED_PLAN_SCENARIO = {
  scenario: PROPOSED_PLAN_SCENARIO_NAME,
  instanceId: "codex",
  model: "gpt-5.6-terra",
  fileName: "planned-codex.txt",
  content: "Planned by Codex.",
  planPrompt:
    "Make a plan, in two short steps, to create planned-codex.txt in the current folder containing exactly this line: Planned by Codex. The plan must say to use apply_patch, not the shell. Do not ask me any questions; propose the plan now.",
} as const satisfies ProposedPlanScenario;

export const PROPOSED_PLAN_IDS = {
  projectId: ProjectId.make("project:proposed-plan"),
  threadId: ThreadId.make("thread:proposed-plan"),
  planMessageId: MessageId.make("message:proposed-plan:1"),
  implementMessageId: MessageId.make("message:proposed-plan:2"),
} as const;

/** What **Implement** sends (T3 Code's `buildPlanImplementationPrompt`). */
const planImplementationPrompt = (markdown: string) =>
  `PLEASE IMPLEMENT THIS PLAN:\n${markdown.trim()}`;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

type ProposedPlan = Extract<OrchestrationV2PlanArtifact, { readonly kind: "proposed_plan" }>;

/**
 * What the interface sends: the project, the thread in plan mode and the
 * message asking for a plan; then, for **Implement**, the default mode and
 * the plan, with `sourcePlanRef`.
 */
export const runProposedPlanScenario = (harness: Harness, scenario: ProposedPlanScenario) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const ids = PROPOSED_PLAN_IDS;
    const folder = path.join(harness.home, "empty-game");
    yield* fs.makeDirectory(folder);
    yield* harness.projects.create({
      commandId: CommandId.make("command:proposed-plan:project"),
      projectId: ids.projectId,
      title: "empty-game",
      workspaceRoot: folder,
    });
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:proposed-plan:thread"),
      threadId: ids.threadId,
      projectId: ids.projectId,
      title: "New thread",
      modelSelection: { instanceId: scenario.instanceId, model: scenario.model },
      runtimeMode: "full-access",
      interactionMode: "plan",
    });
    const asked = yield* harness.orchestrator.dispatch({
      type: "message.dispatch",
      dispatchMode: { type: "start_immediately" },
      commandId: CommandId.make("command:proposed-plan:message:1"),
      threadId: ids.threadId,
      messageId: ids.planMessageId,
      text: scenario.planPrompt,
    });
    yield* harness.worker.drain;
    const planned = yield* harness.awaitRunEnded(ids.threadId, asked.sequence);
    const afterPlan = Option.getOrThrow(
      yield* harness.orchestrator.getThreadProjection(ids.threadId),
    );
    const plan = afterPlan.plans.findLast(
      (candidate): candidate is ProposedPlan =>
        candidate.kind === "proposed_plan" && candidate.status === "active",
    );
    if (plan === undefined) {
      return yield* Effect.die(`The plan turn ended ${planned.status} without a proposed plan.`);
    }
    const fileAfterPlan = yield* fs.exists(path.join(folder, scenario.fileName));

    yield* harness.orchestrator.dispatch({
      type: "thread.interaction-mode.set",
      commandId: CommandId.make("command:proposed-plan:default"),
      threadId: ids.threadId,
      interactionMode: "default",
    });
    const implementing = yield* harness.orchestrator.dispatch({
      type: "message.dispatch",
      dispatchMode: { type: "start_immediately" },
      commandId: CommandId.make("command:proposed-plan:message:2"),
      threadId: ids.threadId,
      messageId: ids.implementMessageId,
      text: planImplementationPrompt(plan.markdown),
      sourcePlanRef: { threadId: ids.threadId, planId: plan.id },
    });
    yield* harness.worker.drain;
    const implemented = yield* harness.awaitRunEnded(ids.threadId, implementing.sequence);
    return { workspace: folder, planned, plan, fileAfterPlan, implemented };
  });

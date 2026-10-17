import type { RunId } from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2PlanArtifact,
  OrchestrationV2PlanStep,
  ProviderInteractionMode,
} from "@playstead/contracts/orchestrationV2";

/**
 * Plan mode in the composer, after T3 Code's `ChatView.logic.ts`
 * (`resolveComposerInteractionMode`, `shouldShowPlanFollowUpPrompt`),
 * `composer-logic.ts` (`parseStandaloneComposerSlashCommand`) and
 * `session-logic.ts` (`findLatestProposedPlan`, `deriveActivePlanState`) at
 * 2577baf.
 */

/**
 * Plan mode is offered only with the client setting **Plan mode (legacy)**
 * on; with it off the composer builds, whatever the thread's mode.
 */
export function resolveComposerInteractionMode(input: {
  readonly planModeEnabled: boolean;
  readonly interactionMode: ProviderInteractionMode;
}): { readonly enabled: boolean; readonly interactionMode: ProviderInteractionMode } {
  return {
    enabled: input.planModeEnabled,
    interactionMode: input.planModeEnabled ? input.interactionMode : "default",
  };
}

/** A message that is only `/plan` or `/default` switches the mode instead of being sent. */
export function parseStandaloneComposerSlashCommand(text: string): ProviderInteractionMode | null {
  const command = /^\/(plan|default)\s*$/i.exec(text.trim())?.[1]?.toLowerCase();
  return command === "plan" ? "plan" : command === "default" ? "default" : null;
}

export interface SlashCommand {
  readonly mode: ProviderInteractionMode;
  readonly label: string;
  readonly description: string;
}

const SLASH_COMMANDS: ReadonlyArray<SlashCommand> = [
  { mode: "plan", label: "/plan", description: "Switch this thread into plan mode" },
  {
    mode: "default",
    label: "/default",
    description: "Switch this thread back to normal build mode",
  },
];

/** The slash commands the typed text begins, when it is a slash and a partial name. */
export function matchSlashCommands(
  text: string,
  planModeEnabled: boolean,
): ReadonlyArray<SlashCommand> {
  if (!planModeEnabled) return [];
  const typed = /^\/([a-z]*)$/i.exec(text.trimStart())?.[1]?.toLowerCase();
  if (typed === undefined) return [];
  return SLASH_COMMANDS.filter((command) => command.label.slice(1).startsWith(typed));
}

type ProposedPlan = Extract<OrchestrationV2PlanArtifact, { readonly kind: "proposed_plan" }>;

/** The plan the banner and **Implement** act on: the latest run's, else the thread's latest. */
export function findLatestProposedPlan(
  plans: ReadonlyArray<OrchestrationV2PlanArtifact>,
  latestRunId: RunId | undefined,
): ProposedPlan | undefined {
  const proposed = plans.filter((plan): plan is ProposedPlan => plan.kind === "proposed_plan");
  const ofRun = proposed.filter((plan) => plan.runId === latestRunId);
  return (ofRun.length > 0 ? ofRun : proposed).at(-1);
}

/** The plan-ready banner and its actions, once the turn that planned has settled. */
export function shouldShowPlanFollowUpPrompt(input: {
  readonly pendingUserInputCount: number;
  readonly interactionMode: ProviderInteractionMode;
  readonly latestRunSettled: boolean;
  readonly hasActionableProposedPlan: boolean;
}): boolean {
  return (
    input.pendingUserInputCount === 0 &&
    input.interactionMode === "plan" &&
    input.latestRunSettled &&
    input.hasActionableProposedPlan
  );
}

export interface ActiveTasks {
  readonly steps: ReadonlyArray<OrchestrationV2PlanStep>;
  /** The step running now, else the next pending one, else the last. */
  readonly current: string;
  readonly completed: number;
  readonly total: number;
}

/**
 * The task progress badge: the running run's own todo list, so an older
 * run's list never labels new work.
 */
export function deriveActiveTasks(
  plans: ReadonlyArray<OrchestrationV2PlanArtifact>,
  activeRunId: RunId | undefined,
): ActiveTasks | undefined {
  if (activeRunId === undefined) return undefined;
  const list = plans.findLast((plan) => plan.kind === "todo_list" && plan.runId === activeRunId);
  if (list?.kind !== "todo_list" || list.steps.length === 0) return undefined;
  const { steps } = list;
  const current =
    steps.find((step) => step.status === "running") ??
    steps.find((step) => step.status === "pending") ??
    steps.at(-1)!;
  return {
    steps,
    current: current.text,
    completed: steps.filter((step) => step.status === "completed").length,
    total: steps.length,
  };
}

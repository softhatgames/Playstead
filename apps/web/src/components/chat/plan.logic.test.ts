import { assert, describe, it } from "@effect/vitest";
import { NodeId, PlanId, RunId, ThreadId } from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2PlanArtifact,
  OrchestrationV2PlanStep,
} from "@playstead/contracts/orchestrationV2";

import {
  deriveActiveTasks,
  findLatestProposedPlan,
  matchSlashCommands,
  parseStandaloneComposerSlashCommand,
  resolveComposerInteractionMode,
  shouldShowPlanFollowUpPrompt,
} from "./plan.logic.ts";

const threadId = ThreadId.make("thread:1");
const run1 = RunId.make("run:1");
const run2 = RunId.make("run:2");

const proposed = (
  id: string,
  runId: RunId,
  status: OrchestrationV2PlanArtifact["status"] = "active",
): OrchestrationV2PlanArtifact => ({
  id: PlanId.make(id),
  threadId,
  runId,
  nodeId: NodeId.make(`node:${id}`),
  status,
  kind: "proposed_plan",
  markdown: `# ${id}`,
});

const todo = (
  id: string,
  runId: RunId,
  steps: ReadonlyArray<OrchestrationV2PlanStep>,
): OrchestrationV2PlanArtifact => ({
  id: PlanId.make(id),
  threadId,
  runId,
  nodeId: NodeId.make(`node:${id}`),
  status: "active",
  kind: "todo_list",
  steps,
});

describe("resolveComposerInteractionMode", () => {
  it("offers plan mode only with Plan mode (legacy) on, and builds otherwise", () => {
    assert.deepStrictEqual(
      resolveComposerInteractionMode({ planModeEnabled: false, interactionMode: "plan" }),
      { enabled: false, interactionMode: "default" },
    );
    assert.deepStrictEqual(
      resolveComposerInteractionMode({ planModeEnabled: true, interactionMode: "plan" }),
      { enabled: true, interactionMode: "plan" },
    );
  });
});

describe("slash commands", () => {
  it("reads a message that is only /plan or /default as a mode switch", () => {
    assert.strictEqual(parseStandaloneComposerSlashCommand(" /plan "), "plan");
    assert.strictEqual(parseStandaloneComposerSlashCommand("/DEFAULT"), "default");
    assert.isNull(parseStandaloneComposerSlashCommand("/plan the level"));
    assert.isNull(parseStandaloneComposerSlashCommand("plan"));
  });

  it("offers the commands a typed slash begins, only with plan mode on", () => {
    assert.deepStrictEqual(
      matchSlashCommands("/", true).map((command) => command.label),
      ["/plan", "/default"],
    );
    assert.deepStrictEqual(
      matchSlashCommands("/de", true).map((command) => command.label),
      ["/default"],
    );
    assert.deepStrictEqual(matchSlashCommands("/plan the level", true), []);
    assert.deepStrictEqual(matchSlashCommands("/", false), []);
  });
});

describe("findLatestProposedPlan", () => {
  it("takes the latest run's plan, else the thread's latest", () => {
    const plans = [proposed("plan:a", run1), proposed("plan:b", run2), proposed("plan:c", run1)];

    assert.strictEqual(findLatestProposedPlan(plans, run2)?.id, "plan:b");
    assert.strictEqual(findLatestProposedPlan(plans, RunId.make("run:3"))?.id, "plan:c");
    assert.isUndefined(findLatestProposedPlan([], run1));
  });
});

describe("shouldShowPlanFollowUpPrompt", () => {
  const base = {
    pendingUserInputCount: 0,
    interactionMode: "plan" as const,
    latestRunSettled: true,
    hasActionableProposedPlan: true,
  };

  it("shows the plan actions for a settled, active plan in plan mode", () => {
    assert.isTrue(shouldShowPlanFollowUpPrompt(base));
  });

  it("hides them while a question waits, a run is active, the plan is done, or in build mode", () => {
    assert.isFalse(shouldShowPlanFollowUpPrompt({ ...base, pendingUserInputCount: 1 }));
    assert.isFalse(shouldShowPlanFollowUpPrompt({ ...base, latestRunSettled: false }));
    assert.isFalse(shouldShowPlanFollowUpPrompt({ ...base, hasActionableProposedPlan: false }));
    assert.isFalse(shouldShowPlanFollowUpPrompt({ ...base, interactionMode: "default" }));
  });
});

describe("deriveActiveTasks", () => {
  const steps: ReadonlyArray<OrchestrationV2PlanStep> = [
    { id: "1", text: "Create first.txt", status: "completed" },
    { id: "2", text: "Create second.txt", status: "running" },
    { id: "3", text: "Reply done", status: "pending" },
  ];

  it("shows the running run's own todo list, its current step and how many are done", () => {
    assert.deepStrictEqual(deriveActiveTasks([todo("todo:1", run1, steps)], run1), {
      steps,
      current: "Create second.txt",
      completed: 1,
      total: 3,
    });
  });

  it("shows nothing between runs, or for another run's list", () => {
    assert.isUndefined(deriveActiveTasks([todo("todo:1", run1, steps)], undefined));
    assert.isUndefined(deriveActiveTasks([todo("todo:1", run1, steps)], run2));
  });

  it("names the next pending step, else the last one, when none is running", () => {
    const done = steps.map((step) => ({ ...step, status: "completed" as const }));
    assert.strictEqual(
      deriveActiveTasks([todo("todo:1", run1, done)], run1)?.current,
      "Reply done",
    );
  });
});

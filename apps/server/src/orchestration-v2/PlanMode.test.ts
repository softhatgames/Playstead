import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  NodeId,
  PlanId,
  ProjectId,
  ThreadId,
} from "@playstead/contracts/baseSchemas";
import {
  OrchestrationDispatchCommandError,
  type ProviderInteractionMode,
} from "@playstead/contracts/orchestrationV2";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import { replayClaude, replayCodex } from "./testkit/ProviderReplay.ts";
import {
  CLAUDE_PROPOSED_PLAN_SCENARIO,
  CODEX_PROPOSED_PLAN_SCENARIO,
  PROPOSED_PLAN_IDS,
  type ProposedPlanScenario,
  runProposedPlanScenario,
} from "./testkit/fixtures/proposedPlan.ts";
import {
  CLAUDE_TODO_LIST_SCENARIO,
  CODEX_TODO_LIST_SCENARIO,
  runTodoListScenario,
  TODO_LIST_IDS,
} from "./testkit/fixtures/todoList.ts";
import { projectionOf } from "./testkit/ThreadCommands.ts";

/**
 * Runs the plan-then-Implement scenario over a replay and checks what the
 * person sees: a proposed plan and no file after the plan turn, then the
 * file written and the plan completed after **Implement**. The replay itself
 * checks the modes the adapter sent for each turn.
 */
const proposedPlanTurns = <E>(
  replay: {
    readonly harness: Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;
    readonly assertComplete: Effect.Effect<void, E>;
  },
  scenario: ProposedPlanScenario,
) =>
  Effect.gen(function* () {
    const { harness } = replay;

    const { planned, plan, fileAfterPlan, implemented } = yield* runProposedPlanScenario(
      harness,
      scenario,
    );

    yield* replay.assertComplete;
    assert.strictEqual(planned.status, "completed");
    assert.isFalse(fileAfterPlan);
    assert.include(plan.markdown, scenario.fileName);
    assert.strictEqual(implemented.status, "completed");
    const projection = Option.getOrThrow(
      yield* harness.orchestrator.getThreadProjection(PROPOSED_PLAN_IDS.threadId),
    );
    // Only the implementing run wrote the file. (Claude Code writes its own
    // plan file under its home while planning, outside the project.)
    const written = projection.turnItems.filter(
      (item) => item.type === "file_change" && item.fileName.endsWith(scenario.fileName),
    );
    assert.lengthOf(written, 1);
    const [file] = written;
    assert.strictEqual(file?.runId, projection.runs.find((run) => run.ordinal === 2)?.id);
    if (file?.type === "file_change") {
      assert.isTrue(file.fileName.endsWith(scenario.fileName));
      assert.strictEqual(file.newStr?.trim(), scenario.content);
    }
    assert.strictEqual(projection.thread.interactionMode, "default");
    const proposed = projection.plans.filter((candidate) => candidate.kind === "proposed_plan");
    assert.deepStrictEqual(
      proposed.map((candidate) => [candidate.id, candidate.status]),
      [[plan.id, "completed"]],
    );
    const card = projection.turnItems.find((item) => item.type === "proposed_plan");
    assert.strictEqual(card?.type, "proposed_plan");
    if (card?.type === "proposed_plan") {
      assert.strictEqual(card.status, "completed");
      assert.isFalse(card.streaming);
      assert.strictEqual(card.markdown, plan.markdown);
    }
    const implementingRun = projection.runs.find((run) => run.ordinal === 2);
    assert.deepStrictEqual(implementingRun?.sourcePlanRef, {
      threadId: PROPOSED_PLAN_IDS.threadId,
      planId: plan.id,
    });
    return projection;
  });

const PROJECT_ID = ProjectId.make("project:plan-mode");
const THREAD_ID = ThreadId.make("thread:plan-mode");

/** Seam 1 without a provider turn: Claude's runner is never reached. */
const harnessWithThread = (interactionMode?: ProviderInteractionMode) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const harness = yield* makeOrchestrationHarness({
      claudeRunner: {
        allocateSessionId: Effect.die("No turn starts in this test."),
        open: () => Effect.die("No turn starts in this test."),
      },
    });
    const folder = path.join(harness.home, "game");
    yield* fs.makeDirectory(folder);
    yield* harness.projects.create({
      commandId: CommandId.make("command:plan-mode:project"),
      projectId: PROJECT_ID,
      title: "game",
      workspaceRoot: folder,
    });
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:plan-mode:thread"),
      threadId: THREAD_ID,
      projectId: PROJECT_ID,
      title: "New thread",
      modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
      runtimeMode: "full-access",
      ...(interactionMode === undefined ? {} : { interactionMode }),
    });
    return harness;
  });

type Harness = Effect.Success<ReturnType<typeof harnessWithThread>>;

const PLAN_ID = PlanId.make("plan:plan-mode:1");
const PLAN_MARKDOWN = "# Write hello.txt\n\n1. Create hello.txt.";

/** A proposed plan on the thread, as a provider's plan turn leaves it. */
const proposePlan = (harness: Harness, status: "active" | "completed" = "active") =>
  harness.eventSink.write([
    {
      type: "plan.updated",
      threadId: THREAD_ID,
      occurredAt: "2026-10-17T00:00:00.000Z",
      payload: {
        id: PLAN_ID,
        threadId: THREAD_ID,
        runId: null,
        nodeId: NodeId.make("node:plan-mode:plan"),
        status,
        kind: "proposed_plan",
        markdown: PLAN_MARKDOWN,
      },
    },
  ]);

const implement = (harness: Harness, threadId: ThreadId, n: number) =>
  harness.orchestrator.dispatch({
    type: "message.dispatch",
    dispatchMode: { type: "start_immediately" },
    commandId: CommandId.make(`command:plan-mode:implement:${n}`),
    threadId,
    messageId: MessageId.make(`message:plan-mode:implement:${n}`),
    text: `PLEASE IMPLEMENT THIS PLAN:\n${PLAN_MARKDOWN}`,
    sourcePlanRef: { threadId: THREAD_ID, planId: PLAN_ID },
  });

const createThread = (harness: Harness, threadId: ThreadId, projectId: ProjectId) =>
  harness.orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`command:plan-mode:create:${threadId}`),
    threadId,
    projectId,
    title: "Implement Write hello.txt",
    modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
  });

describe("Plan mode", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("a thread is created in the default interaction mode unless told otherwise", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread();

        const projection = yield* projectionOf(harness, THREAD_ID);

        assert.strictEqual(projection.thread.interactionMode, "default");
      }),
    );

    it.effect("a thread can be created in plan mode", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread("plan");

        const projection = yield* projectionOf(harness, THREAD_ID);

        assert.strictEqual(projection.thread.interactionMode, "plan");
      }),
    );

    it.effect("switching to plan mode and back is recorded on the thread", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread();

        yield* harness.orchestrator.dispatch({
          type: "thread.interaction-mode.set",
          commandId: CommandId.make("command:plan-mode:plan"),
          threadId: THREAD_ID,
          interactionMode: "plan",
        });
        const planning = yield* projectionOf(harness, THREAD_ID);
        yield* harness.orchestrator.dispatch({
          type: "thread.interaction-mode.set",
          commandId: CommandId.make("command:plan-mode:default"),
          threadId: THREAD_ID,
          interactionMode: "default",
        });
        const building = yield* projectionOf(harness, THREAD_ID);

        assert.strictEqual(planning.thread.interactionMode, "plan");
        assert.strictEqual(building.thread.interactionMode, "default");
      }),
    );

    it.effect("a thread that does not exist has no interaction mode to change", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread();

        const refused = yield* Effect.flip(
          harness.orchestrator.dispatch({
            type: "thread.interaction-mode.set",
            commandId: CommandId.make("command:plan-mode:missing"),
            threadId: ThreadId.make("thread:missing"),
            interactionMode: "plan",
          }),
        );

        assert.instanceOf(refused, OrchestrationDispatchCommandError);
        assert.strictEqual(refused.message, "Thread thread:missing does not exist.");
      }),
    );

    it.effect("implementing a plan that does not exist is refused", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread();

        const refused = yield* Effect.flip(
          harness.orchestrator.dispatch({
            type: "message.dispatch",
            dispatchMode: { type: "start_immediately" },
            commandId: CommandId.make("command:plan-mode:implement"),
            threadId: THREAD_ID,
            messageId: MessageId.make("message:plan-mode:implement"),
            text: "PLEASE IMPLEMENT THIS PLAN:\n# Plan",
            sourcePlanRef: { threadId: THREAD_ID, planId: PlanId.make("plan:missing") },
          }),
        );

        assert.strictEqual(
          refused.message,
          "Proposed plan plan:missing does not exist on thread thread:plan-mode.",
        );
        const projection = yield* projectionOf(harness, THREAD_ID);
        assert.deepStrictEqual(projection.runs, []);
      }),
    );

    it.effect("implementing a proposed plan starts a run for it and completes the plan", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread("plan");
        yield* proposePlan(harness);

        yield* implement(harness, THREAD_ID, 1);

        const projection = yield* projectionOf(harness, THREAD_ID);
        assert.deepStrictEqual(
          projection.plans.map((plan) => [plan.id, plan.status]),
          [[PLAN_ID, "completed"]],
        );
        assert.deepStrictEqual(projection.runs[0]?.sourcePlanRef, {
          threadId: THREAD_ID,
          planId: PLAN_ID,
        });
      }),
    );

    it.effect("a plan implemented in a new thread is completed on its own thread", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread("plan");
        yield* proposePlan(harness);
        const implementing = ThreadId.make("thread:plan-mode:implement");
        yield* createThread(harness, implementing, PROJECT_ID);

        yield* implement(harness, implementing, 1);

        const source = yield* projectionOf(harness, THREAD_ID);
        const target = yield* projectionOf(harness, implementing);
        assert.strictEqual(source.plans[0]?.status, "completed");
        assert.deepStrictEqual(target.plans, []);
        assert.strictEqual(target.thread.interactionMode, "default");
        assert.strictEqual(target.runs[0]?.sourcePlanRef?.planId, PLAN_ID);
      }),
    );

    it.effect("a plan already implemented cannot be implemented again", () =>
      Effect.gen(function* () {
        const harness = yield* harnessWithThread("plan");
        yield* proposePlan(harness, "completed");

        const refused = yield* Effect.flip(implement(harness, THREAD_ID, 1));

        assert.strictEqual(refused.message, "Proposed plan plan:plan-mode:1 is not active.");
      }),
    );

    it.effect("a plan cannot be implemented in another project's thread", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const harness = yield* harnessWithThread("plan");
        yield* proposePlan(harness);
        const otherProject = ProjectId.make("project:plan-mode:other");
        const folder = path.join(harness.home, "other-game");
        yield* fs.makeDirectory(folder);
        yield* harness.projects.create({
          commandId: CommandId.make("command:plan-mode:other-project"),
          projectId: otherProject,
          title: "other-game",
          workspaceRoot: folder,
        });
        const elsewhere = ThreadId.make("thread:plan-mode:elsewhere");
        yield* createThread(harness, elsewhere, otherProject);

        const refused = yield* Effect.flip(implement(harness, elsewhere, 1));

        assert.strictEqual(
          refused.message,
          "Proposed plan plan:plan-mode:1 belongs to a different project.",
        );
        assert.strictEqual((yield* projectionOf(harness, THREAD_ID)).plans[0]?.status, "active");
      }),
    );

    it.effect(
      "Codex proposes a plan in plan mode, then implements it back in the default mode",
      () =>
        Effect.gen(function* () {
          const replay = yield* replayCodex("proposed_plan.codex.ndjson");

          const projection = yield* proposedPlanTurns(replay, CODEX_PROPOSED_PLAN_SCENARIO);

          // One Codex session runs both turns; the replay holds the plan
          // collaboration mode on the first turn/start and the default one on
          // the second, so Codex does not go on planning.
          assert.lengthOf(projection.providerSessions, 1);
        }),
    );

    it.effect(
      "Claude proposes a plan through ExitPlanMode, then resumes its session to implement it",
      () =>
        Effect.gen(function* () {
          const replay = yield* replayClaude("proposed_plan.claude.ndjson");

          const projection = yield* proposedPlanTurns(replay, CLAUDE_PROPOSED_PLAN_SCENARIO);

          // Plan mode is a permission mode, so the query reopened in the default mode.
          assert.deepStrictEqual(
            projection.providerSessions.map((session) => session.status),
            ["stopped", "ready"],
          );
          const exitPlanMode = projection.turnItems.find(
            (item) => item.type === "dynamic_tool" && item.toolName === "ExitPlanMode",
          );
          assert.strictEqual(exitPlanMode?.status, "failed");
        }),
    );

    it.effect.each([
      ["Codex keeps its todo list with its plan tool", "todo_list.codex.ndjson", "codex"],
      ["Claude keeps its todo list with its task tools", "todo_list.claude.ndjson", "claude"],
    ] as const)("%s", ([, recording, provider]) =>
      Effect.gen(function* () {
        const replay =
          provider === "codex" ? yield* replayCodex(recording) : yield* replayClaude(recording);
        const scenario =
          provider === "codex" ? CODEX_TODO_LIST_SCENARIO : CLAUDE_TODO_LIST_SCENARIO;

        const { run } = yield* runTodoListScenario(replay.harness, scenario);

        yield* replay.assertComplete;
        assert.strictEqual(run.status, "completed");
        const projection = Option.getOrThrow(
          yield* replay.harness.orchestrator.getThreadProjection(TODO_LIST_IDS.threadId),
        );
        // One list, updated as each step is done, and shown at each update.
        assert.lengthOf(projection.plans, 1);
        const [list] = projection.plans;
        assert.strictEqual(list?.kind, "todo_list");
        if (list?.kind === "todo_list") {
          assert.lengthOf(list.steps, scenario.steps);
          assert.isTrue(list.steps.every((step) => step.status === "completed"));
        }
        const rows = projection.turnItems.filter((item) => item.type === "todo_list");
        assert.lengthOf(rows, 1);
        assert.strictEqual(rows[0]?.type === "todo_list" ? rows[0].planId : undefined, list?.id);
      }),
    );
  });
});

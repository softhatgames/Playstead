import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { makeOrchestrationHarness } from "../OrchestratorHarness.ts";

/**
 * The agent's todo list (T3 Code's `todo_list` recorder scenario): a thread
 * in the default mode is asked to keep a todo list while it writes two
 * files, ticking each step off. Codex keeps it with its plan tool
 * (`turn/plan/updated`), Claude with its task tools (`TaskCreate`,
 * `TaskUpdate`), which Claude Code 2.1 has in place of `TodoWrite`. Each provider's recorder
 * runs it against the signed-in CLI; the replay tests run it again.
 */
export interface TodoListScenario {
  readonly scenario: string;
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly prompt: string;
  /** The steps the list ends with, all done. */
  readonly steps: number;
}

export const TODO_LIST_SCENARIO_NAME = "todo_list";

export const CLAUDE_TODO_LIST_SCENARIO = {
  scenario: TODO_LIST_SCENARIO_NAME,
  instanceId: "claudeAgent",
  model: "claude-haiku-5-5",
  prompt:
    "Use your TaskCreate tool to make a task list of exactly three tasks: create first.txt, create second.txt, reply done. Use your Write tool, not the shell, to create first.txt containing the word one and second.txt containing the word two in the current folder. Mark each task completed with your TaskUpdate tool as soon as you finish it, then reply with the single word: done",
  steps: 3,
} as const satisfies TodoListScenario;

export const CODEX_TODO_LIST_SCENARIO = {
  scenario: TODO_LIST_SCENARIO_NAME,
  instanceId: "codex",
  model: "gpt-5.6-terra",
  prompt:
    "Use your update_plan tool to keep a todo list of exactly three steps: create first.txt, create second.txt, reply done. Use apply_patch, not the shell, to create first.txt containing the word one and second.txt containing the word two in the current folder. Mark each step completed with update_plan as soon as you finish it, then reply with the single word: done",
  steps: 3,
} as const satisfies TodoListScenario;

export const TODO_LIST_IDS = {
  projectId: ProjectId.make("project:todo-list"),
  threadId: ThreadId.make("thread:todo-list"),
  messageId: MessageId.make("message:todo-list:1"),
} as const;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

/** The project, a thread in Full access and the default mode, and the message. */
export const runTodoListScenario = (harness: Harness, scenario: TodoListScenario) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(harness.home, "empty-game");
    yield* fs.makeDirectory(folder);
    yield* harness.projects.create({
      commandId: CommandId.make("command:todo-list:project"),
      projectId: TODO_LIST_IDS.projectId,
      title: "empty-game",
      workspaceRoot: folder,
    });
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:todo-list:thread"),
      threadId: TODO_LIST_IDS.threadId,
      projectId: TODO_LIST_IDS.projectId,
      title: "New thread",
      modelSelection: { instanceId: scenario.instanceId, model: scenario.model },
      runtimeMode: "full-access",
    });
    const sent = yield* harness.orchestrator.dispatch({
      type: "message.dispatch",
      dispatchMode: { type: "start_immediately" },
      commandId: CommandId.make("command:todo-list:message:1"),
      threadId: TODO_LIST_IDS.threadId,
      messageId: TODO_LIST_IDS.messageId,
      text: scenario.prompt,
    });
    yield* harness.worker.drain;
    const run = yield* harness.awaitRunEnded(TODO_LIST_IDS.threadId, sent.sequence);
    return { workspace: folder, run };
  });

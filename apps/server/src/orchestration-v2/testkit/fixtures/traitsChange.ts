import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { makeOrchestrationHarness } from "../OrchestratorHarness.ts";

/**
 * Traits on the turn start: a thread created with one choice of the model's
 * options, then messages that each carry another, as the composer sends the
 * traits picker's choices. Each provider's recorder runs it against the
 * signed-in CLI; the traits replay tests run it again over the recordings.
 */
export interface TraitsChangeScenario {
  readonly scenario: "traits_change";
  readonly instanceId: ModelSelection["instanceId"];
  readonly model: string;
  /** Each turn's prompt and the options its message carries; the first are the thread's. */
  readonly turns: ReadonlyArray<{
    readonly prompt: string;
    readonly options: NonNullable<ModelSelection["options"]>;
  }>;
}

/**
 * Claude: Low, then High (applied live), then Ultrathink, which T3 Code
 * sends as the model's default effort with the prompt's `Ultrathink:` prefix.
 */
export const CLAUDE_TRAITS_CHANGE_SCENARIO = {
  scenario: "traits_change",
  instanceId: "claudeAgent",
  model: "claude-haiku-5-5",
  turns: [
    { prompt: "Reply with just the word: one.", options: [{ id: "effort", value: "low" }] },
    { prompt: "Reply with just the word: two.", options: [{ id: "effort", value: "high" }] },
    {
      prompt: "Reply with just the word: three.",
      options: [{ id: "effort", value: "ultrathink" }],
    },
  ],
} as const satisfies TraitsChangeScenario;

/** Codex: Low, then High on the Fast service tier. */
export const CODEX_TRAITS_CHANGE_SCENARIO = {
  scenario: "traits_change",
  instanceId: "codex",
  model: "gpt-5.6-terra",
  turns: [
    {
      prompt: "Reply with just the word: one.",
      options: [{ id: "reasoningEffort", value: "low" }],
    },
    {
      prompt: "Reply with just the word: two.",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "serviceTier", value: "priority" },
      ],
    },
  ],
} as const satisfies TraitsChangeScenario;

export const TRAITS_CHANGE_IDS = {
  projectId: ProjectId.make("project:traits-change"),
  threadId: ThreadId.make("thread:traits-change"),
} as const;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

/** The project, the thread with the first turn's options, and each turn in order, awaited. */
export const runTraitsChangeScenario = (harness: Harness, scenario: TraitsChangeScenario) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(harness.home, "traits-game");
    yield* fs.makeDirectory(folder);
    yield* harness.projects.create({
      commandId: CommandId.make("command:traits-change:project"),
      projectId: TRAITS_CHANGE_IDS.projectId,
      title: "traits-game",
      workspaceRoot: folder,
    });
    const selection = (options: TraitsChangeScenario["turns"][number]["options"]) => ({
      instanceId: scenario.instanceId,
      model: scenario.model,
      options,
    });
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:traits-change:thread"),
      threadId: TRAITS_CHANGE_IDS.threadId,
      projectId: TRAITS_CHANGE_IDS.projectId,
      title: "New thread",
      modelSelection: selection(scenario.turns[0]!.options),
    });
    const runs = [];
    for (const [index, turn] of scenario.turns.entries()) {
      const sent = yield* harness.orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`command:traits-change:message:${index + 1}`),
        threadId: TRAITS_CHANGE_IDS.threadId,
        messageId: MessageId.make(`message:traits-change:${index + 1}`),
        text: turn.prompt,
        modelSelection: selection(turn.options),
      });
      yield* harness.worker.drain;
      runs.push(yield* harness.awaitRunEnded(TRAITS_CHANGE_IDS.threadId, sent.sequence));
    }
    return { workspace: folder, runs };
  });

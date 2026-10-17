import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { makeOrchestrationHarness } from "../OrchestratorHarness.ts";

/**
 * The file-creating turn: an empty folder becomes a project, a thread with
 * the provider is created in it, and one message asks it to write a file.
 * Each provider's recorder runs it against the signed-in CLI; the replay
 * tests run it again over the recordings.
 */
export interface FileCreateScenario {
  readonly scenario: string;
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly fileName: string;
  readonly content: string;
  readonly prompt: string;
  readonly titleSeed: string;
}

export const FILE_CREATE_SCENARIO = {
  scenario: "file_create",
  instanceId: "claudeAgent",
  model: "claude-haiku-5-5",
  fileName: "hello-claude.txt",
  content: "Hello from Claude in Playstead!",
  prompt:
    "Use your Write tool, not the shell, to create hello-claude.txt in the current folder containing exactly this line: Hello from Claude in Playstead! Then reply with one short sentence.",
  /** T3 Code's title seed: the message's first 50 characters and an ellipsis. */
  titleSeed: "Use your Write tool, not the shell, to create hell...",
} as const satisfies FileCreateScenario;

/**
 * Codex's turn. Some Codex models write files through the shell, which gives
 * a command item rather than a file change; this model and prompt use
 * `apply_patch`.
 */
export const CODEX_FILE_CREATE_SCENARIO = {
  scenario: "file_create",
  instanceId: "codex",
  model: "gpt-5.6-terra",
  fileName: "hello-codex.txt",
  content: "Hello from Codex in Playstead!",
  prompt:
    "Use apply_patch, not the shell, to create hello-codex.txt in the current folder containing exactly this line: Hello from Codex in Playstead! Then reply with one short sentence.",
  titleSeed: "Use apply_patch, not the shell, to create hello-co...",
} as const satisfies FileCreateScenario;

export const FILE_CREATE_IDS = {
  projectId: ProjectId.make("project:file-create"),
  threadId: ThreadId.make("thread:file-create"),
  messageId: MessageId.make("message:file-create:1"),
} as const;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

/**
 * Sends what the interface sends for this turn: the project, the thread and
 * the message. The run is then starting, and the effect worker has not
 * started its turn.
 */
export const sendFileCreateMessage = (
  harness: Harness,
  scenario: FileCreateScenario = FILE_CREATE_SCENARIO,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(harness.home, "empty-game");
    yield* fs.makeDirectory(folder);
    const project = yield* harness.projects.create({
      commandId: CommandId.make("command:file-create:project"),
      projectId: FILE_CREATE_IDS.projectId,
      title: "empty-game",
      workspaceRoot: folder,
    });

    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:file-create:thread"),
      threadId: FILE_CREATE_IDS.threadId,
      projectId: FILE_CREATE_IDS.projectId,
      title: "New thread",
      modelSelection: { instanceId: scenario.instanceId, model: scenario.model },
      runtimeMode: "full-access",
    });
    const sent = yield* harness.orchestrator.dispatch({
      type: "message.dispatch",
      dispatchMode: { type: "start_immediately" },
      commandId: CommandId.make("command:file-create:message"),
      threadId: FILE_CREATE_IDS.threadId,
      messageId: FILE_CREATE_IDS.messageId,
      text: scenario.prompt,
      titleSeed: scenario.titleSeed,
    });
    return { workspace: project.workspaceRoot, sent };
  });

/**
 * Sends Claude's turn and waits for the run to end. `whileStarting` runs
 * after the message is accepted and before the effect worker starts the
 * turn, while the run is active.
 */
export const runFileCreateScenario = <A = undefined, E = never, R = never>(
  harness: Harness,
  whileStarting?: Effect.Effect<A, E, R>,
) => runProviderFileCreateScenario(harness, FILE_CREATE_SCENARIO, whileStarting);

/** The same turn with the given provider's scenario. */
export const runProviderFileCreateScenario = <A = undefined, E = never, R = never>(
  harness: Harness,
  scenario: FileCreateScenario,
  whileStarting?: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const { workspace, sent } = yield* sendFileCreateMessage(harness, scenario);
    const interjected = whileStarting === undefined ? undefined : yield* whileStarting;
    yield* harness.worker.drain;
    const run = yield* harness.awaitRunEnded(FILE_CREATE_IDS.threadId, sent.sequence);
    return { workspace, run, interjected };
  });

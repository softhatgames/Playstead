import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { makeOrchestrationHarness } from "../OrchestratorHarness.ts";

/**
 * The file-creating turn: an empty folder becomes a project, a thread with
 * Claude is created in it, and one message asks Claude to write a file.
 * The recorder runs it against the signed-in `claude`; the replay test runs
 * it again over the recording.
 */
export const FILE_CREATE_SCENARIO = {
  scenario: "file_create",
  model: "claude-haiku-5-5",
  fileName: "hello-claude.txt",
  content: "Hello from Claude in Playstead!",
  prompt:
    "Use your Write tool, not the shell, to create hello-claude.txt in the current folder containing exactly this line: Hello from Claude in Playstead! Then reply with one short sentence.",
  /** T3 Code's title seed: the message's first 50 characters and an ellipsis. */
  titleSeed: "Use your Write tool, not the shell, to create hell...",
} as const;

export const FILE_CREATE_IDS = {
  projectId: ProjectId.make("project:file-create"),
  threadId: ThreadId.make("thread:file-create"),
  messageId: MessageId.make("message:file-create:1"),
} as const;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

/**
 * Sends what the interface sends for this turn and waits for the run to end.
 * `whileStarting` runs after the message is accepted and before the effect
 * worker starts the turn, while the run is active.
 */
export const runFileCreateScenario = <A = undefined, E = never, R = never>(
  harness: Harness,
  whileStarting?: Effect.Effect<A, E, R>,
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
      modelSelection: { instanceId: "claudeAgent", model: FILE_CREATE_SCENARIO.model },
    });
    const sent = yield* harness.orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("command:file-create:message"),
      threadId: FILE_CREATE_IDS.threadId,
      messageId: FILE_CREATE_IDS.messageId,
      text: FILE_CREATE_SCENARIO.prompt,
      titleSeed: FILE_CREATE_SCENARIO.titleSeed,
    });
    const interjected = whileStarting === undefined ? undefined : yield* whileStarting;
    yield* harness.worker.drain;
    const run = yield* harness.awaitRunEnded(FILE_CREATE_IDS.threadId, sent.sequence);
    return { workspace: project.workspaceRoot, run, interjected };
  });

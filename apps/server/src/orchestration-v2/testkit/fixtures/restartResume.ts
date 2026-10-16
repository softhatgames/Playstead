import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { makeOrchestrationHarness } from "../OrchestratorHarness.ts";

/**
 * A conversation across a restart: Claude is told a code word, the server
 * restarts, and Claude is asked for the word. It can answer only if the
 * restarted server resumed Claude's own session. The recorder runs it
 * against the signed-in `claude`; the restart test replays it.
 */
export const RESTART_RESUME_SCENARIO = {
  scenario: "restart_resume",
  model: "claude-haiku-5-5",
  codeWord: "tangerine",
  firstPrompt: "Remember this code word for later: tangerine. Reply with just: OK.",
  secondPrompt: "What was the code word I gave you? Reply with just the word.",
} as const;

export const RESTART_RESUME_IDS = {
  projectId: ProjectId.make("project:restart-resume"),
  threadId: ThreadId.make("thread:restart-resume"),
} as const;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

const sendAndAwait = (harness: Harness, turn: 1 | 2, text: string) =>
  Effect.gen(function* () {
    const sent = yield* harness.orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`command:restart-resume:message:${turn}`),
      threadId: RESTART_RESUME_IDS.threadId,
      messageId: MessageId.make(`message:restart-resume:${turn}`),
      text,
    });
    yield* harness.worker.drain;
    return yield* harness.awaitRunEnded(RESTART_RESUME_IDS.threadId, sent.sequence);
  });

/** Before the restart: the project, the thread, and the message with the code word. */
export const runFirstTurn = (harness: Harness) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(harness.home, "resumed-game");
    yield* fs.makeDirectory(folder);
    yield* harness.projects.create({
      commandId: CommandId.make("command:restart-resume:project"),
      projectId: RESTART_RESUME_IDS.projectId,
      title: "resumed-game",
      workspaceRoot: folder,
    });
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:restart-resume:thread"),
      threadId: RESTART_RESUME_IDS.threadId,
      projectId: RESTART_RESUME_IDS.projectId,
      title: "New thread",
      modelSelection: { instanceId: "claudeAgent", model: RESTART_RESUME_SCENARIO.model },
    });
    const run = yield* sendAndAwait(harness, 1, RESTART_RESUME_SCENARIO.firstPrompt);
    return { workspace: folder, run };
  });

/** After the restart: the question only the earlier conversation answers. */
export const runSecondTurn = (harness: Harness) =>
  sendAndAwait(harness, 2, RESTART_RESUME_SCENARIO.secondPrompt);

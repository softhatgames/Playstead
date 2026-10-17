import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { makeOrchestrationHarness } from "../OrchestratorHarness.ts";

/**
 * Auto, then a mode change between turns: a thread created in Auto is asked
 * to write a file, which the provider does without asking the person; its
 * mode then changes to Full access, and the next message runs in that mode.
 * Each provider's recorder runs it against the signed-in CLI; the replay
 * tests run it again over the recordings, which hold what the adapter sent
 * for each mode.
 */
export interface AutoModeScenario {
  readonly scenario: string;
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly fileName: string;
  readonly content: string;
  readonly writePrompt: string;
  readonly nextPrompt: string;
  /** The word the reply to `nextPrompt` holds. */
  readonly nextReply: string;
}

export const CLAUDE_AUTO_MODE_SCENARIO = {
  scenario: "auto_mode",
  instanceId: "claudeAgent",
  model: "claude-haiku-5-5",
  fileName: "auto-claude.txt",
  content: "written-by-claude-in-auto",
  writePrompt:
    "Use your Write tool, not the shell, to create auto-claude.txt in the current folder containing exactly this one word: written-by-claude-in-auto. Then reply with one short sentence.",
  nextPrompt: "Reply with the single word: ready",
  nextReply: "ready",
} as const satisfies AutoModeScenario;

export const CODEX_AUTO_MODE_SCENARIO = {
  scenario: "auto_mode",
  instanceId: "codex",
  model: "gpt-5.6-terra",
  fileName: "auto-codex.txt",
  content: "Written by Codex in Auto.",
  writePrompt:
    "Use apply_patch, not the shell, to create auto-codex.txt in the current folder containing exactly this line: Written by Codex in Auto. Then reply with one short sentence.",
  nextPrompt: "Reply with the single word: ready",
  nextReply: "ready",
} as const satisfies AutoModeScenario;

export const AUTO_MODE_IDS = {
  projectId: ProjectId.make("project:auto-mode"),
  threadId: ThreadId.make("thread:auto-mode"),
  writeMessageId: MessageId.make("message:auto-mode:1"),
  nextMessageId: MessageId.make("message:auto-mode:2"),
} as const;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

const sendAndAwait = (harness: Harness, turn: 1 | 2, messageId: MessageId, text: string) =>
  Effect.gen(function* () {
    const sent = yield* harness.orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`command:auto-mode:message:${turn}`),
      threadId: AUTO_MODE_IDS.threadId,
      messageId,
      text,
    });
    yield* harness.worker.drain;
    return yield* harness.awaitRunEnded(AUTO_MODE_IDS.threadId, sent.sequence);
  });

/**
 * What the interface sends: the project, the thread in Auto and the message
 * that writes the file; then the mode Full access, sent before the next
 * message as the composer sends a mode chosen in its draft.
 */
export const runAutoModeScenario = (harness: Harness, scenario: AutoModeScenario) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(harness.home, "empty-game");
    yield* fs.makeDirectory(folder);
    const project = yield* harness.projects.create({
      commandId: CommandId.make("command:auto-mode:project"),
      projectId: AUTO_MODE_IDS.projectId,
      title: "empty-game",
      workspaceRoot: folder,
    });
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:auto-mode:thread"),
      threadId: AUTO_MODE_IDS.threadId,
      projectId: AUTO_MODE_IDS.projectId,
      title: "New thread",
      modelSelection: { instanceId: scenario.instanceId, model: scenario.model },
      runtimeMode: "auto",
    });
    const write = yield* sendAndAwait(
      harness,
      1,
      AUTO_MODE_IDS.writeMessageId,
      scenario.writePrompt,
    );
    yield* harness.orchestrator.dispatch({
      type: "thread.runtime-mode.set",
      commandId: CommandId.make("command:auto-mode:full-access"),
      threadId: AUTO_MODE_IDS.threadId,
      runtimeMode: "full-access",
    });
    const next = yield* sendAndAwait(harness, 2, AUTO_MODE_IDS.nextMessageId, scenario.nextPrompt);
    return { workspace: project.workspaceRoot, write, next };
  });

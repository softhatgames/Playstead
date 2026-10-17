import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import {
  ACTIVE_RUN_STATUSES,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  type ProviderApprovalDecision,
  type RuntimeMode,
} from "@playstead/contracts/orchestrationV2";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import type { makeOrchestrationHarness } from "../OrchestratorHarness.ts";

/**
 * Auto-accept edits and approvals for the session (T3 Code's `tool_call_*`
 * fixtures ask under policy overrides; Playstead asks under the modes). A
 * thread sends its turns one after another, each in its runtime mode, sent
 * before the message as the composer sends a mode chosen in its draft; the
 * person answers every approval a turn asks for with the turn's decision,
 * as the approval panel sends it. Each provider's recorder runs them
 * against the signed-in CLI; the replay tests run them again over the
 * recordings.
 *
 * - `auto_accept_edits`: in Auto-accept edits, a file is written without
 *   asking and a command that needs the network asks, and is approved.
 * - `session_command`: such a command approved with **Always allow this
 *   session**; in the next turn the command runs without asking; then the
 *   mode changes to Supervised, the command asks again and is allowed for
 *   the session again, and in the turn after it runs without asking. What the
 *   session allows differs by provider, so the commands do too: Claude
 *   Code's suggested rule allows the exact command, so Claude repeats it;
 *   the adapter's allowance for Codex covers every command, while Codex
 *   itself skips asking again for the exact command it was allowed, even in
 *   another mode, so Codex runs a new one each turn.
 * - `session_edits`: in Supervised, two files written in one turn, the first
 *   approved for the session; then a third file in the next turn.
 */
export interface SessionApprovalTurn {
  readonly runtimeMode: RuntimeMode;
  readonly prompt: string;
  /** The decision for every approval the turn asks for. */
  readonly answer: ProviderApprovalDecision;
}

export interface SessionApprovalScenario {
  readonly scenario: SessionApprovalScenarioName;
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly turns: ReadonlyArray<SessionApprovalTurn>;
  /** The files the turns write, in the project's folder. */
  readonly fileNames: ReadonlyArray<string>;
}

export type SessionApprovalScenarioName = "auto_accept_edits" | "session_command" | "session_edits";

/** A command each provider's sandbox or permission checks hold back in these modes: it needs the network. */
const networkCommand = (host: string) => `curl -sI https://${host}`;

const commandPrompt = (tool: string, host: string) =>
  `Use your ${tool} to run exactly this command once: ${networkCommand(host)} It needs network access, so ask for approval to run it outside any sandbox; do not try another way. Then reply with its HTTP status line only.`;

const CLAUDE = { instanceId: "claudeAgent", model: "claude-haiku-5-5" } as const;
const CODEX = { instanceId: "codex", model: "gpt-5.6-terra" } as const;

export const SESSION_APPROVAL_SCENARIOS = {
  claude: {
    auto_accept_edits: {
      ...CLAUDE,
      scenario: "auto_accept_edits",
      fileNames: ["edits-claude.txt"],
      turns: [
        {
          runtimeMode: "auto-accept-edits",
          prompt: `First use your Write tool, not the shell, to create edits-claude.txt in the current folder containing exactly this one word: written-without-asking. Then use your Bash tool to run exactly this command once: ${networkCommand("example.com")} If you are not allowed to, do not try another way. Reply with its HTTP status line only.`,
          answer: "accept",
        },
      ],
    },
    session_command: {
      ...CLAUDE,
      scenario: "session_command",
      fileNames: [],
      turns: [
        {
          runtimeMode: "auto-accept-edits",
          prompt: commandPrompt("Bash tool", "example.com"),
          answer: "acceptForSession",
        },
        {
          runtimeMode: "auto-accept-edits",
          prompt: commandPrompt("Bash tool", "example.com"),
          answer: "accept",
        },
        {
          runtimeMode: "approval-required",
          prompt: commandPrompt("Bash tool", "example.com"),
          answer: "acceptForSession",
        },
        {
          runtimeMode: "approval-required",
          prompt: commandPrompt("Bash tool", "example.com"),
          answer: "accept",
        },
      ],
    },
    session_edits: {
      ...CLAUDE,
      scenario: "session_edits",
      fileNames: ["first-claude.txt", "second-claude.txt", "third-claude.txt"],
      turns: [
        {
          runtimeMode: "approval-required",
          prompt:
            "Use your Write tool twice, not the shell: first create first-claude.txt in the current folder containing exactly: one. Then create second-claude.txt containing exactly: two. If you are not allowed to, do not try another way. Reply with one short sentence.",
          answer: "acceptForSession",
        },
        {
          runtimeMode: "approval-required",
          prompt:
            "Use your Write tool, not the shell, to create third-claude.txt in the current folder containing exactly: three. If you are not allowed to, do not try another way. Reply with one short sentence.",
          answer: "accept",
        },
      ],
    },
  },
  codex: {
    auto_accept_edits: {
      ...CODEX,
      scenario: "auto_accept_edits",
      fileNames: ["edits-codex.txt"],
      turns: [
        {
          runtimeMode: "auto-accept-edits",
          prompt: `First use apply_patch, not the shell, to create edits-codex.txt in the current folder containing exactly this line: Written without asking. Then run exactly this shell command once: ${networkCommand("example.com")} It needs network access, so ask for approval to run it outside the sandbox; do not try another way. Reply with its HTTP status line only.`,
          answer: "accept",
        },
      ],
    },
    session_command: {
      ...CODEX,
      scenario: "session_command",
      fileNames: [],
      turns: [
        {
          runtimeMode: "auto-accept-edits",
          prompt: commandPrompt("shell", "example.com"),
          answer: "acceptForSession",
        },
        {
          runtimeMode: "auto-accept-edits",
          prompt: commandPrompt("shell", "example.org"),
          answer: "accept",
        },
        {
          runtimeMode: "approval-required",
          prompt: commandPrompt("shell", "example.net"),
          answer: "acceptForSession",
        },
        {
          runtimeMode: "approval-required",
          prompt: commandPrompt("shell", "www.example.com"),
          answer: "accept",
        },
      ],
    },
    session_edits: {
      ...CODEX,
      scenario: "session_edits",
      fileNames: ["first-codex.txt", "second-codex.txt", "third-codex.txt"],
      turns: [
        {
          runtimeMode: "approval-required",
          prompt:
            "Use apply_patch twice, as two separate calls, not the shell: first create first-codex.txt in the current folder containing exactly this line: one. Then create second-codex.txt containing exactly this line: two. If you are not allowed to, do not try another way. Reply with one short sentence.",
          answer: "acceptForSession",
        },
        {
          runtimeMode: "approval-required",
          prompt:
            "Use apply_patch, not the shell, to create third-codex.txt in the current folder containing exactly this line: three. If you are not allowed to, do not try another way. Reply with one short sentence.",
          answer: "accept",
        },
      ],
    },
  },
} as const satisfies Record<
  "claude" | "codex",
  Record<SessionApprovalScenarioName, SessionApprovalScenario>
>;

export const SESSION_APPROVAL_IDS = {
  projectId: ProjectId.make("project:session-approvals"),
  threadId: ThreadId.make("thread:session-approvals"),
} as const;

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

export interface SessionApprovalTurnResult {
  readonly run: OrchestrationV2Run;
  readonly approvals: ReadonlyArray<OrchestrationV2RuntimeRequest>;
}

/** Sends one turn's message and answers its approvals until its run ends. */
const runTurn = (
  harness: Harness,
  turn: SessionApprovalTurn,
  index: number,
  previousMode: RuntimeMode,
) =>
  Effect.gen(function* () {
    const threadId = SESSION_APPROVAL_IDS.threadId;
    if (turn.runtimeMode !== previousMode) {
      yield* harness.orchestrator.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make(`command:session-approvals:mode:${index + 1}`),
        threadId,
        runtimeMode: turn.runtimeMode,
      });
    }
    const sent = yield* harness.orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`command:session-approvals:message:${index + 1}`),
      threadId,
      messageId: MessageId.make(`message:session-approvals:${index + 1}`),
      text: turn.prompt,
    });
    yield* harness.worker.drain;
    const approvals: Array<OrchestrationV2RuntimeRequest> = [];
    const ended = yield* harness.eventStore
      .streamApplicationEvents({ afterSequence: sent.sequence })
      .pipe(
        Stream.mapEffect((stored) =>
          Effect.gen(function* () {
            if (stored.aggregateKind !== "thread") return undefined;
            const event = stored.event;
            if (event.threadId !== threadId) return undefined;
            if (event.type === "run.updated" && !ACTIVE_RUN_STATUSES.has(event.payload.status)) {
              return event.payload;
            }
            if (
              event.type !== "runtime-request.updated" ||
              event.payload.status !== "pending" ||
              event.payload.kind === "user_input"
            ) {
              return undefined;
            }
            approvals.push(event.payload);
            yield* harness.orchestrator.dispatch({
              type: "runtime-request.respond",
              commandId: CommandId.make(
                `command:session-approvals:respond:${index + 1}:${approvals.length}`,
              ),
              threadId,
              requestId: event.payload.id,
              decision: turn.answer,
            });
            yield* harness.worker.drain;
            return undefined;
          }),
        ),
        Stream.filter((run): run is OrchestrationV2Run => run !== undefined),
        Stream.runHead,
      );
    if (Option.isNone(ended)) return yield* Effect.die("The event stream ended before the run.");
    return { run: ended.value, approvals } satisfies SessionApprovalTurnResult;
  });

/** The project, the thread in the first turn's mode, then each turn in order. */
export const runSessionApprovalScenario = (harness: Harness, scenario: SessionApprovalScenario) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(harness.home, "empty-game");
    yield* fs.makeDirectory(folder);
    yield* harness.projects.create({
      commandId: CommandId.make("command:session-approvals:project"),
      projectId: SESSION_APPROVAL_IDS.projectId,
      title: "empty-game",
      workspaceRoot: folder,
    });
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:session-approvals:thread"),
      threadId: SESSION_APPROVAL_IDS.threadId,
      projectId: SESSION_APPROVAL_IDS.projectId,
      title: "New thread",
      modelSelection: { instanceId: scenario.instanceId, model: scenario.model },
      runtimeMode: scenario.turns[0]!.runtimeMode,
    });
    const turns: Array<SessionApprovalTurnResult> = [];
    for (const [index, turn] of scenario.turns.entries()) {
      const previousMode = scenario.turns[index - 1]?.runtimeMode ?? turn.runtimeMode;
      turns.push(yield* runTurn(harness, turn, index, previousMode));
    }
    return { workspace: folder, turns };
  });

/** What a recorder logs about a recorded run: each turn's status and approvals, and the files on disk. */
export const describeSessionApprovalRun = (
  workspace: string,
  scenario: SessionApprovalScenario,
  turns: ReadonlyArray<SessionApprovalTurnResult>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = yield* Effect.forEach(scenario.fileNames, (name) =>
      Effect.map(
        fs.exists(path.join(workspace, name)),
        (exists) => `${name} ${exists ? "written" : "missing"}`,
      ),
    );
    return {
      runs: turns.map((turn) => turn.run.status).join(", "),
      approvals: turns
        .map((turn) => `[${turn.approvals.map((approval) => approval.kind).join(", ")}]`)
        .join(" "),
      files: files.join(", "),
    };
  });

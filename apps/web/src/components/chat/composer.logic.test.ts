import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
} from "@playstead/contracts/orchestrationV2";
import type { ServerProvider } from "@playstead/contracts/server";

import {
  buildSendCommands,
  defaultModelSelection,
  deriveComposerAction,
  deriveModelPickerEntries,
} from "./composer.logic.ts";

const provider = (
  instanceId: ServerProvider["instanceId"],
  overrides: Partial<ServerProvider> = {},
): ServerProvider => ({
  instanceId,
  driver: instanceId,
  displayName: instanceId === "codex" ? "Codex" : "Claude",
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-17T00:00:00.000Z",
  models:
    instanceId === "codex"
      ? [{ slug: "gpt-fake", name: "GPT Fake", isDefault: true }]
      : [
          { slug: "claude-opus-5-5", name: "Claude Opus 5.5" },
          { slug: "claude-fable-5-1", name: "Claude Fable 5.1", isDefault: true },
        ],
  ...overrides,
});

describe("deriveModelPickerEntries", () => {
  it("offers every provider that runs models until the thread starts, then only its own", () => {
    const providers = [provider("codex"), provider("claudeAgent")];

    assert.deepStrictEqual(
      deriveModelPickerEntries(providers, undefined).map((entry) => entry.instanceId),
      ["codex", "claudeAgent"],
    );
    assert.deepStrictEqual(
      deriveModelPickerEntries(providers, "claudeAgent").map((entry) => [
        entry.instanceId,
        entry.models.map((model) => model.slug),
      ]),
      [["claudeAgent", ["claude-opus-5-5", "claude-fable-5-1"]]],
    );
  });

  it("leaves out a provider that is not installed or has no models", () => {
    const providers = [
      provider("codex", { installed: false }),
      provider("claudeAgent", { models: [] }),
    ];

    assert.deepStrictEqual(deriveModelPickerEntries(providers, undefined), []);
  });
});

describe("defaultModelSelection", () => {
  it("picks the first provider's default model", () => {
    assert.deepStrictEqual(
      defaultModelSelection([provider("codex", { installed: false }), provider("claudeAgent")]),
      {
        instanceId: "claudeAgent",
        model: "claude-fable-5-1",
      },
    );
    assert.isUndefined(defaultModelSelection([]));
  });
});

describe("buildSendCommands", () => {
  const ids = {
    threadCommandId: CommandId.make("command:thread"),
    messageCommandId: CommandId.make("command:message"),
    messageId: MessageId.make("message:1"),
  };

  it("creates the thread first when sending from a new thread, titled from the message", () => {
    const commands = buildSendCommands({
      target: {
        kind: "new",
        threadId: ThreadId.make("thread:new"),
        projectId: ProjectId.make("project:1"),
        modelSelection: { instanceId: "claudeAgent", model: "claude-fable-5-1" },
      },
      text: "  Make a tiny platformer\n",
      ids,
    });

    assert.deepStrictEqual<unknown>(commands, [
      {
        type: "thread.create",
        commandId: "command:thread",
        threadId: "thread:new",
        projectId: "project:1",
        title: "New thread",
        modelSelection: { instanceId: "claudeAgent", model: "claude-fable-5-1" },
      },
      {
        type: "message.dispatch",
        commandId: "command:message",
        threadId: "thread:new",
        messageId: "message:1",
        text: "Make a tiny platformer",
        titleSeed: "Make a tiny platformer",
      },
    ]);
  });

  it("sends only the message to a thread that has one already", () => {
    const commands = buildSendCommands({
      target: { kind: "existing", threadId: ThreadId.make("thread:1"), hasMessages: true },
      text: "Now add a jump",
      ids,
    });

    assert.deepStrictEqual<unknown>(commands, [
      {
        type: "message.dispatch",
        commandId: "command:message",
        threadId: "thread:1",
        messageId: "message:1",
        text: "Now add a jump",
      },
    ]);
  });
});

describe("deriveComposerAction", () => {
  const at = "2026-10-17T00:00:00.000Z";
  const run = (id: string, status: OrchestrationV2Run["status"]): OrchestrationV2Run => ({
    id: RunId.make(id),
    threadId: ThreadId.make("thread:1"),
    ordinal: 1,
    providerInstanceId: "codex",
    modelSelection: { instanceId: "codex", model: "gpt-fake" },
    providerThreadId: null,
    userMessageId: MessageId.make("message:1"),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: at,
    startedAt: null,
    completedAt: null,
  });
  const interruptRequest = (runId: string): OrchestrationV2TurnItem => ({
    id: TurnItemId.make(`item:${runId}:interrupt-request`),
    threadId: ThreadId.make("thread:1"),
    runId: RunId.make(runId),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    ordinal: 2,
    status: "completed",
    title: "Interrupt requested",
    startedAt: at,
    completedAt: at,
    updatedAt: at,
    type: "run_interrupt_request",
    message: "Interrupt requested",
  });

  it("offers sending while no run is active", () => {
    assert.deepStrictEqual(deriveComposerAction([run("run:1", "interrupted")], []), {
      kind: "send",
    });
  });

  it("offers only Interrupt, for the active run, while one runs", () => {
    assert.deepStrictEqual(
      deriveComposerAction([run("run:1", "completed"), run("run:2", "starting")], []),
      { kind: "interrupt", runId: RunId.make("run:2") },
    );
  });

  it("shows the run stopping once Interrupt was pressed, until it has", () => {
    assert.deepStrictEqual(
      deriveComposerAction([run("run:2", "running")], [interruptRequest("run:2")]),
      { kind: "interrupting" },
    );
  });
});

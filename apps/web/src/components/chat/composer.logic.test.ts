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
  canChooseModel,
  defaultModelSelection,
  deriveComposerAction,
  deriveModelPickerEntries,
  isComposerModeShortcut,
  isEditQueuedMessageShortcut,
  isSendAlternateShortcut,
  resolveComposerSelection,
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
      ? [{ slug: "gpt-fake", name: "GPT Fake", isDefault: true, capabilities: null }]
      : [
          { slug: "claude-opus-5-5", name: "Claude Opus 5.5", capabilities: null },
          {
            slug: "claude-fable-5-1",
            name: "Claude Fable 5.1",
            isDefault: true,
            capabilities: null,
          },
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
    runtimeModeCommandId: CommandId.make("command:mode"),
  };

  it("creates the thread first, in the draft's mode, when sending from a new thread, titled from the message", () => {
    const commands = buildSendCommands({
      target: {
        kind: "new",
        threadId: ThreadId.make("thread:new"),
        projectId: ProjectId.make("project:1"),
        modelSelection: { instanceId: "claudeAgent", model: "claude-fable-5-1" },
      },
      runtimeMode: "auto",
      dispatchMode: "auto",
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
        runtimeMode: "auto",
      },
      {
        type: "message.dispatch",
        commandId: "command:message",
        threadId: "thread:new",
        messageId: "message:1",
        text: "Make a tiny platformer",
        titleSeed: "Make a tiny platformer",
        dispatchMode: { type: "start_immediately" },
        deliveryIntent: "auto",
      },
    ]);
  });

  it("sends only the message to a thread that has one already, with the composer's traits", () => {
    const commands = buildSendCommands({
      target: {
        kind: "existing",
        threadId: ThreadId.make("thread:1"),
        hasMessages: true,
        runtimeMode: "full-access",
        modelSelection: {
          instanceId: "codex",
          model: "gpt-5.6-terra",
          options: [{ id: "reasoningEffort", value: "high" }],
        },
      },
      runtimeMode: "full-access",
      dispatchMode: "auto",
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
        modelSelection: {
          instanceId: "codex",
          model: "gpt-5.6-terra",
          options: [{ id: "reasoningEffort", value: "high" }],
        },
        dispatchMode: { type: "start_immediately" },
        deliveryIntent: "auto",
      },
    ]);
  });

  it("sends a mode chosen in the composer before the next message", () => {
    const commands = buildSendCommands({
      target: {
        kind: "existing",
        threadId: ThreadId.make("thread:1"),
        hasMessages: true,
        runtimeMode: "full-access",
        modelSelection: { instanceId: "codex", model: "gpt-5.6-terra" },
      },
      runtimeMode: "auto",
      dispatchMode: "auto",
      text: "Now add a jump",
      ids,
    });

    assert.deepStrictEqual<unknown>(commands, [
      {
        type: "thread.runtime-mode.set",
        commandId: "command:mode",
        threadId: "thread:1",
        runtimeMode: "auto",
      },
      {
        type: "message.dispatch",
        commandId: "command:message",
        threadId: "thread:1",
        messageId: "message:1",
        text: "Now add a jump",
        modelSelection: { instanceId: "codex", model: "gpt-5.6-terra" },
        dispatchMode: { type: "start_immediately" },
        deliveryIntent: "auto",
      },
    ]);
  });

  it("queues a message sent while a run is active behind it", () => {
    const commands = buildSendCommands({
      target: {
        kind: "existing",
        threadId: ThreadId.make("thread:1"),
        hasMessages: true,
        runtimeMode: "full-access",
        modelSelection: { instanceId: "codex", model: "gpt-5.6-terra" },
      },
      runtimeMode: "full-access",
      dispatchMode: "queue",
      text: "Then add a second level",
      ids,
    });

    assert.deepStrictEqual<unknown>(commands, [
      {
        type: "message.dispatch",
        commandId: "command:message",
        threadId: "thread:1",
        messageId: "message:1",
        text: "Then add a second level",
        modelSelection: { instanceId: "codex", model: "gpt-5.6-terra" },
        dispatchMode: { type: "queue_after_active" },
      },
    ]);
  });
});

describe("resolveComposerSelection", () => {
  const terra = { instanceId: "codex", model: "gpt-5.6-terra" } as const;
  const high = [{ id: "reasoningEffort", value: "high" }] as const;
  const low = [{ id: "reasoningEffort", value: "low" }] as const;
  const recall = (instanceId: string, model: string) =>
    instanceId === "codex" && model === "gpt-5.6-terra" ? low : undefined;

  it("starts a new thread on the traits remembered for its model", () => {
    assert.deepStrictEqual(
      resolveComposerSelection({ selection: terra, chosen: undefined, recall, isDraft: true }),
      { ...terra, options: low },
    );
    assert.deepStrictEqual(
      resolveComposerSelection({
        selection: { instanceId: "codex", model: "gpt-6.1-sol" },
        chosen: undefined,
        recall,
        isDraft: true,
      }),
      { instanceId: "codex", model: "gpt-6.1-sol" },
    );
  });

  it("keeps a started thread's own traits rather than the remembered ones", () => {
    assert.deepStrictEqual(
      resolveComposerSelection({ selection: terra, chosen: undefined, recall, isDraft: false }),
      terra,
    );
  });

  it("uses the traits chosen in the composer, but only for the model they were chosen on", () => {
    assert.deepStrictEqual(
      resolveComposerSelection({
        selection: terra,
        chosen: { ...terra, options: high },
        recall,
        isDraft: false,
      }),
      { ...terra, options: high },
    );
    assert.deepStrictEqual(
      resolveComposerSelection({
        selection: terra,
        chosen: { instanceId: "codex", model: "gpt-6.1-sol", options: high },
        recall,
        isDraft: false,
      }),
      terra,
    );
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

  const action = (input: {
    readonly runs: ReadonlyArray<OrchestrationV2Run>;
    readonly turnItems?: ReadonlyArray<OrchestrationV2TurnItem>;
    readonly hasContent?: boolean;
    readonly editingQueuedMessage?: boolean;
    readonly canResume?: boolean;
  }) =>
    deriveComposerAction({
      runs: input.runs,
      turnItems: input.turnItems ?? [],
      hasContent: input.hasContent ?? false,
      editingQueuedMessage: input.editingQueuedMessage ?? false,
      canResume: input.canResume ?? false,
      dispatchMode: input.runs.some((candidate) => candidate.status === "running")
        ? "queue"
        : "auto",
    });

  it("offers sending while no run is active", () => {
    assert.deepStrictEqual(action({ runs: [run("run:1", "completed")], hasContent: true }), {
      kind: "send",
    });
  });

  it("offers Interrupt, for the active run, while one runs and nothing is typed", () => {
    assert.deepStrictEqual(
      action({ runs: [run("run:1", "completed"), run("run:2", "starting")] }),
      { kind: "interrupt", runId: RunId.make("run:2") },
    );
  });

  it("queues what is typed while a run is active", () => {
    assert.deepStrictEqual(action({ runs: [run("run:2", "running")], hasContent: true }), {
      kind: "queue",
    });
  });

  it("shows the run stopping once Interrupt was pressed, until it has", () => {
    assert.deepStrictEqual(
      action({ runs: [run("run:2", "running")], turnItems: [interruptRequest("run:2")] }),
      { kind: "interrupting" },
    );
  });

  it("offers Resume in an empty composer after a stop, and sending once something is typed", () => {
    assert.deepStrictEqual(
      [
        action({ runs: [run("run:1", "interrupted")], canResume: true }),
        action({ runs: [run("run:1", "interrupted")], canResume: true, hasContent: true }),
      ],
      [{ kind: "resume" }, { kind: "send" }],
    );
  });

  it("saves a queued message being edited, even while a run is active", () => {
    assert.deepStrictEqual(
      action({ runs: [run("run:2", "running")], editingQueuedMessage: true, canResume: true }),
      { kind: "update-queued" },
    );
  });
});

describe("isComposerModeShortcut", () => {
  const keys = (key: string, held: ReadonlyArray<"meta" | "ctrl" | "shift" | "alt">) => ({
    key,
    metaKey: held.includes("meta"),
    ctrlKey: held.includes("ctrl"),
    shiftKey: held.includes("shift"),
    altKey: held.includes("alt"),
  });

  it("is mod+shift+a: Command on a Mac, Control elsewhere", () => {
    assert.deepStrictEqual(
      [
        isComposerModeShortcut(keys("A", ["meta", "shift"]), "MacIntel"),
        isComposerModeShortcut(keys("a", ["ctrl", "shift"]), "Win32"),
        isComposerModeShortcut(keys("A", ["ctrl", "shift"]), "Linux x86_64"),
      ],
      [true, true, true],
    );
  });

  it("is not another chord with the same key", () => {
    assert.deepStrictEqual(
      [
        isComposerModeShortcut(keys("A", ["ctrl", "shift"]), "MacIntel"),
        isComposerModeShortcut(keys("a", ["meta"]), "MacIntel"),
        isComposerModeShortcut(keys("A", ["meta", "shift", "alt"]), "MacIntel"),
        isComposerModeShortcut(keys("A", ["meta", "ctrl", "shift"]), "MacIntel"),
        isComposerModeShortcut(keys("S", ["meta", "shift"]), "MacIntel"),
      ],
      [false, false, false, false, false],
    );
  });
});

describe("queue shortcuts", () => {
  const keys = (key: string, held: ReadonlyArray<"meta" | "ctrl" | "shift" | "alt">) => ({
    key,
    metaKey: held.includes("meta"),
    ctrlKey: held.includes("ctrl"),
    shiftKey: held.includes("shift"),
    altKey: held.includes("alt"),
  });

  it("sends the other follow-up with mod+enter", () => {
    assert.deepStrictEqual(
      [
        isSendAlternateShortcut(keys("Enter", ["meta"]), "MacIntel"),
        isSendAlternateShortcut(keys("Enter", ["ctrl"]), "Win32"),
        isSendAlternateShortcut(keys("Enter", []), "MacIntel"),
        isSendAlternateShortcut(keys("Enter", ["meta", "shift"]), "MacIntel"),
      ],
      [true, true, false, false],
    );
  });

  it("edits the last queued message with alt+arrowup alone", () => {
    assert.deepStrictEqual(
      [
        isEditQueuedMessageShortcut(keys("ArrowUp", ["alt"])),
        isEditQueuedMessageShortcut(keys("ArrowUp", [])),
        isEditQueuedMessageShortcut(keys("ArrowUp", ["alt", "shift"])),
      ],
      [true, false, false],
    );
  });
});

describe("canChooseModel", () => {
  it("lets the model change for the next message, but not for a queued one being edited", () => {
    assert.deepStrictEqual(
      [
        canChooseModel({ kind: "send" }),
        canChooseModel({ kind: "queue" }),
        canChooseModel({ kind: "interrupt", runId: RunId.make("run:1") }),
        canChooseModel({ kind: "update-queued" }),
      ],
      [true, true, true, false],
    );
  });
});

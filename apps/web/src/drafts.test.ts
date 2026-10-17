import { CommandId, MessageId, ProjectId } from "@playstead/contracts/baseSchemas";
import { describe, expect, it } from "@effect/vitest";

import { buildSendCommands } from "./components/chat/composer.logic.ts";
import { createDraft, readDraft, setDraftRuntimeMode } from "./drafts.ts";

const projectId = ProjectId.make("project:my-game");

const firstSend = (draftId: string) => {
  const draft = readDraft(draftId)!;
  return buildSendCommands({
    target: {
      kind: "new",
      threadId: draft.threadId,
      projectId,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-terra" },
    },
    runtimeMode: draft.runtimeMode,
    text: "Make a game",
    ids: {
      threadCommandId: draft.threadCommandId,
      messageCommandId: CommandId.make("command:message"),
      messageId: MessageId.make("message:1"),
      runtimeModeCommandId: CommandId.make("command:mode"),
    },
  })[0];
};

describe("new thread drafts", () => {
  it("creates the thread with the default permissions for new threads", () => {
    const draftId = createDraft(projectId, { defaultRuntimeMode: "auto" });

    expect(firstSend(draftId)).toMatchObject({ type: "thread.create", runtimeMode: "auto" });
  });

  it("keeps an open draft's permissions when the default changes", () => {
    const chosen = createDraft(projectId, { defaultRuntimeMode: "full-access" });
    setDraftRuntimeMode(chosen, "auto");
    const untouched = createDraft(projectId, { defaultRuntimeMode: "auto" });

    const later = createDraft(projectId, { defaultRuntimeMode: "full-access" });

    expect(firstSend(chosen)).toMatchObject({ runtimeMode: "auto" });
    expect(firstSend(untouched)).toMatchObject({ runtimeMode: "auto" });
    expect(firstSend(later)).toMatchObject({ runtimeMode: "full-access" });
  });
});

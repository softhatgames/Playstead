import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { materializeReplayWorkspace, type ProviderReplayTranscript } from "./replayTranscript.ts";

const recording: ProviderReplayTranscript = {
  header: {
    type: "transcript_start",
    provider: "claude",
    protocol: "claude-agent-sdk",
    version: "2.1.301",
    capturedAt: "2026-10-16",
    scenario: "file_create",
  },
  entries: [
    {
      type: "emit_inbound",
      frame: {
        cwd: "<workspace>",
        input: { file_path: "<workspace>/src/hello-claude.txt" },
        content:
          "File created successfully at: <workspace>/hello-claude.txt (file state is current)",
      },
    },
  ],
};

const framesIn = (workspace: string) =>
  materializeReplayWorkspace(recording, workspace).pipe(
    Effect.map((transcript) => transcript.entries.map((entry) => entry.frame)),
  );

describe("A replay fills in its workspace", () => {
  it.effect("with Windows paths on Windows, as a live run there reports them", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* framesIn("C:\\Temp\\empty-game"), [
        {
          cwd: "C:\\Temp\\empty-game",
          input: { file_path: "C:\\Temp\\empty-game\\src\\hello-claude.txt" },
          content:
            "File created successfully at: C:\\Temp\\empty-game\\hello-claude.txt (file state is current)",
        },
      ]);
    }).pipe(Effect.provide(NodePath.layerWin32)),
  );

  it.effect("with POSIX paths on macOS and Linux", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* framesIn("/tmp/empty-game"), [
        {
          cwd: "/tmp/empty-game",
          input: { file_path: "/tmp/empty-game/src/hello-claude.txt" },
          content:
            "File created successfully at: /tmp/empty-game/hello-claude.txt (file state is current)",
        },
      ]);
    }).pipe(Effect.provide(NodePath.layerPosix)),
  );
});

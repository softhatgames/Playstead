// @effect-diagnostics preferSchemaOverJson:off -- Recorded frames are plain JSON lines.
import * as CodexClient from "@playstead/effect-codex-app-server/client";
import * as CodexAppServerReplay from "@playstead/effect-codex-app-server/replay";
import type {
  ProviderReplayEntry,
  ProviderReplayTranscript,
} from "@playstead/provider-testing/replayTranscript";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import { spawnCodexAppServer } from "../../provider/CodexProvider.ts";
import { CodexAppServerClientFactory } from "./CodexAdapterV2.ts";

/**
 * Codex's app-server from a recording, and the recorder's tap on the real
 * one (T3 Code's `CodexAdapterV2.testkit.ts` and
 * `apps/server/scripts/record-codex-app-server-replay-fixture.ts` at
 * 2577baf). A recording is every line the client wrote to Codex
 * (`expect_outbound`) and every line Codex wrote back (`emit_inbound`), in
 * order. A replay runs the real client over the replay driver, which
 * compares each line the client sends with the recording, strictly.
 */

export const CODEX_REPLAY_PROVIDER = "codex";
export const CODEX_REPLAY_PROTOCOL = "codex.app-server";

export interface CodexReplay {
  readonly clients: CodexAppServerClientFactory["Service"];
  /** Fails unless the session's app-server was opened, every frame matched and the whole recording was used. */
  readonly assertComplete: Effect.Effect<void, CodexAppServerReplay.CodexAppServerReplayError>;
}

/** One session's app-server from the recording; a second session finds none. */
export const makeCodexReplay = Effect.fn("makeCodexReplay")(function* (
  transcript: ProviderReplayTranscript,
) {
  const driver = yield* CodexAppServerReplay.makeReplayDriver({
    provider: CODEX_REPLAY_PROVIDER,
    protocol: CODEX_REPLAY_PROTOCOL,
    version: transcript.header.version,
    scenario: transcript.header.scenario,
    capturedAt: transcript.header.capturedAt,
    ...(transcript.header.metadata === undefined ? {} : { metadata: transcript.header.metadata }),
    entries: transcript.entries,
  });
  let opened = false;
  const clients = CodexAppServerClientFactory.of({
    open: () =>
      Effect.suspend(() => {
        if (opened) return Effect.die("The Codex recording holds one app-server.");
        opened = true;
        return CodexAppServerReplay.makeReplayClient(driver);
      }),
  });
  const assertComplete = Effect.suspend(() =>
    opened ? driver.assertComplete : Effect.die("The adapter never opened Codex's app-server."),
  );
  return { clients, assertComplete } satisfies CodexReplay;
});

const decoder = () => new TextDecoder();
const encoder = new TextEncoder();

/** Each whole line of a byte stream, as it passes. */
const lineTap = (onLine: (line: string) => void) => {
  const text = decoder();
  let buffered = "";
  return (chunk: Uint8Array | string) => {
    buffered += typeof chunk === "string" ? chunk : text.decode(chunk, { stream: true });
    let end = buffered.indexOf("\n");
    while (end >= 0) {
      const line = buffered.slice(0, end).trim();
      buffered = buffered.slice(end + 1);
      if (line.length > 0) onLine(line);
      end = buffered.indexOf("\n");
    }
  };
};

/**
 * The real app-server, with every line the client writes and every line
 * Codex answers kept in order for a recording. The recorder cleans them
 * before writing.
 */
export const makeRecordingClientFactory = Effect.fn("makeRecordingClientFactory")(function* () {
  // Only these two, so each app-server belongs to its session's scope.
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const entries: Array<ProviderReplayEntry> = [];
  const record = (type: ProviderReplayEntry["type"]) =>
    lineTap((line) => entries.push({ type, frame: JSON.parse(line) as unknown }));
  const clients = CodexAppServerClientFactory.of({
    open: (input) =>
      Effect.gen(function* () {
        const handle = yield* spawnCodexAppServer(input);
        const { stdio, terminationError } = yield* CodexClient.childProcessStdio(handle);
        const inbound = record("emit_inbound");
        const outbound = record("expect_outbound");
        const tapped = Stdio.make({
          args: stdio.args,
          stdin: stdio.stdin.pipe(Stream.tap((chunk) => Effect.sync(() => inbound(chunk)))),
          stdout: () =>
            Sink.mapInput(stdio.stdout(), (chunk: string | Uint8Array) => {
              outbound(chunk);
              return typeof chunk === "string" ? encoder.encode(chunk) : chunk;
            }),
          stderr: stdio.stderr,
        });
        return yield* CodexClient.make(tapped, { terminationError });
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
      ),
  });
  return { clients, entries };
});

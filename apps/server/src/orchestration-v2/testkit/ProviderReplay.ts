import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
  type ProviderReplayTranscript,
} from "@playstead/provider-testing/replayTranscript";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { type ClaudeReplayOptions, makeClaudeReplay } from "../Adapters/ClaudeAdapterV2.testkit.ts";
import { makeCodexReplay } from "../Adapters/CodexAdapterV2.testkit.ts";
import { makeOrchestrationHarness } from "./OrchestratorHarness.ts";

/** A recording in `testkit/fixtures`, by file name. */
export const readRecording = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(
      path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
      "fixtures",
      name,
    );
    return yield* decodeProviderReplayNdjson(yield* fs.readFileString(file));
  });

export interface ProviderReplayOptions {
  readonly harness?: Omit<
    Parameters<typeof makeOrchestrationHarness>[0],
    "claudeRunner" | "codexClients"
  >;
  /** The scenario's project folder in the harness's home, which stands for `<workspace>`. */
  readonly workspace?: string;
  /** Changes the recording before it is replayed. */
  readonly edit?: (recording: ProviderReplayTranscript) => ProviderReplayTranscript;
}

const readEdited = (name: string, options: ProviderReplayOptions) =>
  Effect.map(readRecording(name), options.edit ?? ((recording) => recording));

/** The recording with `<workspace>` made the scenario's folder in the harness's home. */
const inHarnessHome = (
  recorded: ProviderReplayTranscript,
  home: string,
  options: ProviderReplayOptions,
) =>
  Effect.flatMap(Path.Path, (path) =>
    materializeReplayWorkspace(recorded, path.join(home, options.workspace ?? "empty-game")),
  );

/**
 * Seam 1 with Claude's `query()` replaying a recording made in the
 * harness's folder. The harness comes first, as the workspace is its own
 * folder and known only once it exists; `recorded` is the recording as
 * read (and edited), before the workspace is put in.
 */
export const replayClaude = (
  name: string,
  options: ProviderReplayOptions & { readonly claude?: ClaudeReplayOptions } = {},
) =>
  Effect.gen(function* () {
    const recorded = yield* readEdited(name, options);
    let replay: Effect.Success<ReturnType<typeof makeClaudeReplay>> | undefined;
    const harness = yield* makeOrchestrationHarness({
      ...options.harness,
      claudeRunner: {
        allocateSessionId: Effect.suspend(() => replay!.runner.allocateSessionId),
        open: (input) => Effect.suspend(() => replay!.runner.open(input)),
      },
    });
    replay = yield* makeClaudeReplay(
      yield* inHarnessHome(recorded, harness.home, options),
      options.claude,
    );
    return { harness, replay, recorded, assertComplete: replay.assertComplete };
  });

/** Seam 1 with Codex's app-server replaying a recording made in the harness's folder. */
export const replayCodex = (name: string, options: ProviderReplayOptions = {}) =>
  Effect.gen(function* () {
    const recorded = yield* readEdited(name, options);
    let replay: Effect.Success<ReturnType<typeof makeCodexReplay>> | undefined;
    const harness = yield* makeOrchestrationHarness({
      ...options.harness,
      codexClients: { open: (input) => Effect.suspend(() => replay!.clients.open(input)) },
    });
    replay = yield* makeCodexReplay(yield* inHarnessHome(recorded, harness.home, options));
    return { harness, replay, recorded, assertComplete: replay.assertComplete };
  });

/** Seam 1 with either provider's transport replaying a recording. */
export const replayProvider = (
  provider: "claude" | "codex",
  name: string,
  options: ProviderReplayOptions = {},
) =>
  Effect.gen(function* () {
    const { harness, recorded, assertComplete } =
      provider === "claude"
        ? yield* replayClaude(name, options)
        : yield* replayCodex(name, options);
    return { harness, recorded, assertComplete };
  });

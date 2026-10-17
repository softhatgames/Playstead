import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { ProviderReplayTranscript } from "@playstead/provider-testing/replayTranscript";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { replayClaude, replayCodex } from "./testkit/ProviderReplay.ts";
import {
  CLAUDE_TRAITS_CHANGE_SCENARIO,
  CODEX_TRAITS_CHANGE_SCENARIO,
  runTraitsChangeScenario,
  TRAITS_CHANGE_IDS,
} from "./testkit/fixtures/traitsChange.ts";

/** The frames the adapter sent, by type or method, as the recording keeps them. */
const outbound = (recording: ProviderReplayTranscript, kind: string) =>
  recording.entries.flatMap((entry) => {
    if (entry.type !== "expect_outbound") return [];
    const frame = entry.frame as { type?: unknown; method?: unknown };
    return frame.type === kind || frame.method === kind
      ? [entry.frame as Record<string, unknown>]
      : [];
  });

/**
 * Seam 1 over Playstead's recordings of the signed-in Claude and Codex: a
 * thread's traits (the model's options the person chose) reach each turn
 * start. Every frame the adapter sends is compared with the recording; the
 * checks below say what those frames must be.
 */
describe("Traits on the turn start", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("Claude opens on the chosen effort, changes it live, and prefixes Ultrathink", () =>
      Effect.gen(function* () {
        const { harness, recorded, assertComplete } = yield* replayClaude(
          "traits_change.claude.ndjson",
          { workspace: "traits-game" },
        );

        const { runs } = yield* runTraitsChangeScenario(harness, CLAUDE_TRAITS_CHANGE_SCENARIO);

        yield* assertComplete;
        assert.deepStrictEqual<unknown>(
          runs.map((run) => [run.status, run.modelSelection.options]),
          CLAUDE_TRAITS_CHANGE_SCENARIO.turns.map((turn) => ["completed", turn.options]),
        );
        const projection = Option.getOrThrow(
          yield* harness.orchestrator.getThreadProjection(TRAITS_CHANGE_IDS.threadId),
        );
        assert.deepStrictEqual(projection.thread.modelSelection.options, [
          { id: "effort", value: "ultrathink" },
        ]);

        const [open] = outbound(recorded, "query.open");
        assert.deepInclude(open?.["options"], {
          model: "claude-haiku-5-5",
          effort: "low",
          thinking: { type: "adaptive", display: "summarized" },
          settings: { showThinkingSummaries: true },
          extraArgs: { "thinking-display": "summarized" },
        });
        assert.deepStrictEqual(outbound(recorded, "query.set_model"), [
          { type: "query.set_model", model: "claude-haiku-5-5" },
          { type: "query.set_model", model: "claude-haiku-5-5" },
        ]);
        // Ultrathink is the prompt's prefix; the effort goes back to the model's default.
        // Haiku has no Fast Mode, and neither turn is Ultracode, so both are cleared.
        assert.deepStrictEqual(outbound(recorded, "query.apply_flag_settings"), [
          {
            type: "query.apply_flag_settings",
            settings: { effortLevel: "high", fastMode: null, ultracode: null },
          },
          {
            type: "query.apply_flag_settings",
            settings: { effortLevel: "medium", fastMode: null, ultracode: null },
          },
        ]);
        assert.deepStrictEqual(
          outbound(recorded, "prompt.offer").map(
            (frame) => (frame["message"] as { message: { content: unknown } }).message.content,
          ),
          [
            "Reply with just the word: one.",
            "Reply with just the word: two.",
            "Ultrathink:\nReply with just the word: three.",
          ],
        );
      }).pipe(Effect.scoped),
    );

    it.effect("Codex gets the chosen effort and service tier and detailed summaries", () =>
      Effect.gen(function* () {
        const { harness, recorded, assertComplete } = yield* replayCodex(
          "traits_change.codex.ndjson",
          { workspace: "traits-game" },
        );

        const { runs } = yield* runTraitsChangeScenario(harness, CODEX_TRAITS_CHANGE_SCENARIO);

        yield* assertComplete;
        assert.deepStrictEqual<unknown>(
          runs.map((run) => [run.status, run.modelSelection.options]),
          CODEX_TRAITS_CHANGE_SCENARIO.turns.map((turn) => ["completed", turn.options]),
        );
        assert.deepStrictEqual(
          outbound(recorded, "turn/start").map((frame) => {
            const params = frame["params"] as Record<string, unknown>;
            return {
              summary: params["summary"],
              effort: params["effort"],
              serviceTier: params["serviceTier"],
            };
          }),
          [
            { summary: "detailed", effort: "low", serviceTier: undefined },
            { summary: "detailed", effort: "high", serviceTier: "priority" },
          ],
        );
      }).pipe(Effect.scoped),
    );
  });
});

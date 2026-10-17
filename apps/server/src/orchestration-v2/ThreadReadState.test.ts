import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2Command } from "@playstead/contracts/orchestrationV2";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import {
  FILE_CREATE_IDS,
  FILE_CREATE_SCENARIO,
  runFileCreateScenario,
  sendFileCreateMessage,
} from "./testkit/fixtures/fileCreate.ts";
import { refusal, threadOf } from "./testkit/ThreadCommands.ts";
import { replayClaude } from "./testkit/ProviderReplay.ts";

/**
 * Seam 1 for renaming a thread and its read state (T3 Code's
 * `Orchestrator.ts` `dispatchThreadVisit` and `dispatchThreadMutation`
 * cases for `thread.metadata.update` and `thread.mark-unread` at 2577baf):
 * the real orchestrator, effect worker and projections, with Claude's
 * transport replaying the file-create recording for a completed run.
 */

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

const command = (harness: Harness, sent: OrchestrationV2Command) =>
  harness.orchestrator.dispatch(sent);

const threadId = FILE_CREATE_IDS.threadId;

/** The ISO time `milliseconds` after `iso`. */
const shifted = (iso: string, milliseconds: number) =>
  DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(iso), { milliseconds }));

describe("Rename a thread and mark it unread", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("renaming a thread changes its title", () =>
      Effect.gen(function* () {
        const { harness } = yield* replayClaude("file_create.claude.ndjson");
        const { run } = yield* runFileCreateScenario(harness);
        assert.strictEqual(run.status, "completed");
        assert.strictEqual(
          (yield* threadOf(harness, threadId)).title,
          FILE_CREATE_SCENARIO.titleSeed,
        );

        yield* command(harness, {
          type: "thread.metadata.update",
          commandId: CommandId.make("command:rename"),
          threadId,
          title: "Hello file",
        });
        const renamed = yield* threadOf(harness, threadId);
        assert.strictEqual(renamed.title, "Hello file");
      }).pipe(Effect.scoped),
    );

    it.effect(
      "marking a thread unread is refused until a run completes, then puts the read marker just before the completion",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* replayClaude("file_create.claude.ndjson");
          const { sent } = yield* sendFileCreateMessage(harness);
          assert.strictEqual(
            yield* refusal(
              command(harness, {
                type: "thread.mark-unread",
                commandId: CommandId.make("command:mark-unread-early"),
                threadId,
              }),
            ),
            `Thread ${threadId} has no completed run to mark unread.`,
          );
          yield* harness.worker.drain;
          const run = yield* harness.awaitRunEnded(threadId, sent.sequence);
          assert.strictEqual(run.status, "completed");
          const completedAt = run.completedAt!;

          const visitedAt = shifted(completedAt, 60_000);
          yield* command(harness, {
            type: "thread.visit",
            commandId: CommandId.make("command:visit"),
            threadId,
            visitedAt,
          });
          const visited = yield* threadOf(harness, threadId);
          assert.strictEqual(visited.lastVisitedAt, visitedAt);

          yield* TestClock.adjust("1 minute");
          yield* command(harness, {
            type: "thread.mark-unread",
            commandId: CommandId.make("command:mark-unread"),
            threadId,
          });
          const unread = yield* threadOf(harness, threadId);
          assert.strictEqual(unread.lastVisitedAt, shifted(completedAt, -1));
          // Marking unread is not activity.
          assert.strictEqual(unread.updatedAt, visited.updatedAt);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "a run's work is activity, while a visit is not and only moves the read marker forward",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* replayClaude("file_create.claude.ndjson");
          const { sent } = yield* sendFileCreateMessage(harness);
          const sentAt = (yield* threadOf(harness, threadId)).updatedAt;
          yield* TestClock.adjust("1 minute");
          yield* harness.worker.drain;
          const run = yield* harness.awaitRunEnded(threadId, sent.sequence);
          const before = yield* threadOf(harness, threadId);
          assert.isNull(before.lastVisitedAt);
          // The thread was updated when its run completed, a minute after the message.
          assert.isAbove(Date.parse(run.completedAt!), Date.parse(sentAt));
          assert.strictEqual(before.updatedAt, run.completedAt);

          const visit = (id: string, visitedAt: string) =>
            command(harness, {
              type: "thread.visit",
              commandId: CommandId.make(id),
              threadId,
              visitedAt,
            });
          const later = shifted(run.completedAt!, 2_000);
          const earlier = shifted(run.completedAt!, 1_000);
          yield* TestClock.adjust("1 minute");
          yield* visit("command:visit-later", later);
          yield* visit("command:visit-earlier", earlier);
          const after = yield* threadOf(harness, threadId);
          assert.strictEqual(after.lastVisitedAt, later);
          assert.strictEqual(after.updatedAt, before.updatedAt);
        }).pipe(Effect.scoped),
    );

    it.effect("a deleted thread refuses a rename, a visit and marking it unread", () =>
      Effect.gen(function* () {
        const { harness } = yield* replayClaude("file_create.claude.ndjson");
        const { run } = yield* runFileCreateScenario(harness);
        yield* command(harness, {
          type: "thread.delete",
          commandId: CommandId.make("command:delete"),
          threadId,
        });
        for (const sent of [
          {
            type: "thread.metadata.update",
            commandId: CommandId.make("command:after:rename"),
            threadId,
            title: "Too late",
          },
          {
            type: "thread.visit",
            commandId: CommandId.make("command:after:visit"),
            threadId,
            visitedAt: run.completedAt!,
          },
          {
            type: "thread.mark-unread",
            commandId: CommandId.make("command:after:mark-unread"),
            threadId,
          },
        ] satisfies ReadonlyArray<OrchestrationV2Command>) {
          assert.strictEqual(
            yield* refusal(command(harness, sent)),
            `Thread ${threadId} is deleted.`,
            sent.type,
          );
        }
      }).pipe(Effect.scoped),
    );
  });
});

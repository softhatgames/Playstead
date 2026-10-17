import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, type ThreadId } from "@playstead/contracts/baseSchemas";
import type { OrchestrationV2Command } from "@playstead/contracts/orchestrationV2";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import { FILE_CREATE_IDS, runFileCreateScenario } from "./testkit/fixtures/fileCreate.ts";
import { refusal, threadOf } from "./testkit/ThreadCommands.ts";
import { replayClaude } from "./testkit/ProviderReplay.ts";

/**
 * Seam 1 for arranging threads (T3 Code's `Orchestrator.ts`
 * `dispatchThreadMutation` cases for `thread.pin.reorder` and
 * `thread.active.reorder` at 2577baf): the real orchestrator and
 * projections, with Claude's transport replaying a recording for the
 * thread's first turn. The client makes the order keys; the server stores
 * them as they come.
 */

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

const send = (harness: Harness, command: Record<string, unknown> & { readonly type: string }) =>
  harness.orchestrator.dispatch(command as unknown as OrchestrationV2Command);

const reorder = (
  harness: Harness,
  threadId: ThreadId,
  type: "thread.pin.reorder" | "thread.active.reorder",
  id: string,
  orderKey: string,
) => send(harness, { type, commandId: CommandId.make(id), threadId, orderKey });

describe("Arrange threads", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("a pinned thread takes a new place among the pins, which counts as a change", () =>
      Effect.gen(function* () {
        const { harness } = yield* replayClaude("file_create.claude.ndjson");
        yield* runFileCreateScenario(harness);
        const threadId = FILE_CREATE_IDS.threadId;
        yield* send(harness, {
          type: "thread.pin",
          commandId: CommandId.make("command:pin"),
          threadId,
          orderKey: "m",
        });
        const pinned = yield* threadOf(harness, threadId);

        yield* TestClock.adjust("1 minute");
        yield* reorder(harness, threadId, "thread.pin.reorder", "command:reorder", "g");
        const moved = yield* threadOf(harness, threadId);
        assert.strictEqual(moved.pinOrderKey, "g");
        assert.isAbove(Date.parse(moved.updatedAt), Date.parse(pinned.updatedAt));

        yield* TestClock.adjust("1 minute");
        yield* reorder(harness, threadId, "thread.pin.reorder", "command:reorder-same", "g");
        assert.strictEqual((yield* threadOf(harness, threadId)).updatedAt, moved.updatedAt);

        assert.strictEqual(
          yield* refusal(
            reorder(harness, threadId, "thread.active.reorder", "command:active-pinned", "k"),
          ),
          `Thread ${threadId} is not active and cannot be reordered.`,
        );
      }).pipe(Effect.scoped),
    );

    it.effect(
      "an active thread takes a place in Active without counting as activity, and keeps it while pinned",
      () =>
        Effect.gen(function* () {
          const { harness } = yield* replayClaude("file_create.claude.ndjson");
          yield* runFileCreateScenario(harness);
          const threadId = FILE_CREATE_IDS.threadId;
          const before = yield* threadOf(harness, threadId);

          assert.strictEqual(
            yield* refusal(
              reorder(harness, threadId, "thread.pin.reorder", "command:pin-unpinned", "g"),
            ),
            `Thread ${threadId} is not pinned and cannot be reordered.`,
          );

          yield* TestClock.adjust("1 minute");
          yield* reorder(harness, threadId, "thread.active.reorder", "command:active", "k");
          const arranged = yield* threadOf(harness, threadId);
          assert.strictEqual(arranged.activeOrderKey, "k");
          assert.strictEqual(arranged.updatedAt, before.updatedAt);

          yield* send(harness, {
            type: "thread.pin",
            commandId: CommandId.make("command:pin"),
            threadId,
          });
          yield* send(harness, {
            type: "thread.unpin",
            commandId: CommandId.make("command:unpin"),
            threadId,
          });
          assert.strictEqual((yield* threadOf(harness, threadId)).activeOrderKey, "k");

          yield* send(harness, {
            type: "thread.settle",
            commandId: CommandId.make("command:settle"),
            threadId,
          });
          assert.isNull((yield* threadOf(harness, threadId)).activeOrderKey);
          assert.strictEqual(
            yield* refusal(
              reorder(harness, threadId, "thread.active.reorder", "command:active-settled", "k"),
            ),
            `Thread ${threadId} is not active and cannot be reordered.`,
          );
        }).pipe(Effect.scoped),
    );

    it.effect("an archived thread refuses both reorders, and a deleted one refuses them too", () =>
      Effect.gen(function* () {
        const { harness } = yield* replayClaude("file_create.claude.ndjson");
        yield* runFileCreateScenario(harness);
        const threadId = FILE_CREATE_IDS.threadId;
        yield* send(harness, {
          type: "thread.pin",
          commandId: CommandId.make("command:pin"),
          threadId,
        });
        yield* send(harness, {
          type: "thread.archive",
          commandId: CommandId.make("command:archive"),
          threadId,
        });
        const types = ["thread.pin.reorder", "thread.active.reorder"] as const;
        for (const type of types) {
          assert.strictEqual(
            yield* refusal(reorder(harness, threadId, type, `command:archived:${type}`, "g")),
            `Thread ${threadId} is archived.`,
            type,
          );
        }
        yield* send(harness, {
          type: "thread.delete",
          commandId: CommandId.make("command:delete"),
          threadId,
        });
        for (const type of types) {
          assert.strictEqual(
            yield* refusal(reorder(harness, threadId, type, `command:deleted:${type}`, "g")),
            `Thread ${threadId} is deleted.`,
            type,
          );
        }
      }).pipe(Effect.scoped),
    );
  });
});

import * as Stream from "effect/Stream";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import { ChildProcessSpawner } from "effect/process";
import type { ServerConfig } from "../config.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId } from "@playstead/contracts/baseSchemas";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import { FILE_CREATE_IDS, sendFileCreateMessage } from "./testkit/fixtures/fileCreate.ts";
import { makeClaudeReplay } from "./Adapters/ClaudeAdapterV2.testkit.ts";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
} from "@playstead/provider-testing/replayTranscript";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { makeTestServerConfig } from "../testUtils/testServer.ts";

const makeHarness = (
  titleCliSource?: string,
  existingConfig?: ServerConfig["Service"],
  recoverOnStartup = false,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = existingConfig ?? (yield* makeTestServerConfig());
    const recording = yield* decodeProviderReplayNdjson(
      yield* fs.readFileString(
        yield* path.fromFileUrl(
          new URL("./testkit/fixtures/file_create.claude.ndjson", import.meta.url),
        ),
      ),
    );
    const replay = yield* makeClaudeReplay(
      yield* materializeReplayWorkspace(recording, path.join(config.baseDir, "empty-game")),
    );
    return yield* makeOrchestrationHarness({
      claudeRunner: replay.runner,
      config,
      recoverOnStartup,
      ...(titleCliSource ? { titleCliSource } : {}),
    });
  });

describe("Generated thread titles", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "deleting a thread cancels its running title process",
      () =>
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const stopped = yield* Deferred.make<void>();
          const real = yield* ChildProcessSpawner.ChildProcessSpawner;
          const gated = ChildProcessSpawner.make((command) => {
            const title =
              command._tag === "StandardCommand" &&
              (command.args.includes("exec") ||
                command.command.replaceAll("^", "").includes('"exec"'));
            return title
              ? Effect.andThen(Deferred.succeed(entered, undefined), Effect.never).pipe(
                  Effect.ensuring(Deferred.succeed(stopped, undefined)),
                )
              : real.spawn(command);
          });
          const h = yield* makeHarness().pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, gated),
          );
          yield* sendFileCreateMessage(h);
          yield* h.worker.runDaemon.pipe(Effect.forkScoped);
          yield* Deferred.await(entered);
          yield* h.orchestrator.dispatch({
            type: "thread.delete",
            commandId: CommandId.make("delete-generating"),
            threadId: FILE_CREATE_IDS.threadId,
          });
          yield* Deferred.await(stopped);
          assert.isNull(
            Option.getOrThrow(yield* h.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId))
              .thread.titleRegeneration,
          );
        }).pipe(Effect.scoped),
      { timeout: 5000 },
    );
    it.effect("title generation finishes while provider-turn.start is still blocked", () =>
      Effect.gen(function* () {
        const opening = yield* Deferred.make<void>();
        const h = yield* makeOrchestrationHarness({
          claudeRunner: {
            allocateSessionId: Effect.succeed("slow-session"),
            open: () => Effect.andThen(Deferred.succeed(opening, undefined), Effect.never),
          },
          titleCliSource: `
          import { writeFileSync } from 'node:fs';
          const args=process.argv.slice(2);
          if(args.includes('mcp')) console.log('[]');
          else if(args[0] === 'exec') { for await(const chunk of process.stdin) {} writeFileSync(args[args.indexOf('--output-last-message')+1], '{"title":"Independent title"}'); }
        `,
        });
        const { sent } = yield* sendFileCreateMessage(h);
        yield* h.worker.runDaemon.pipe(Effect.forkScoped);
        yield* Deferred.await(opening);
        yield* h.eventStore.streamApplicationEvents({ afterSequence: sent.sequence }).pipe(
          Stream.filter(
            (stored) =>
              stored.aggregateKind === "thread" &&
              stored.event.type === "thread.metadata-updated" &&
              stored.event.payload.title === "Independent title",
          ),
          Stream.runHead,
        );
        const projection = Option.getOrThrow(
          yield* h.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
        );
        assert.strictEqual(projection.thread.title, "Independent title");
        assert.strictEqual(projection.runs[0]?.status, "starting");
      }).pipe(Effect.scoped),
    );
    it.effect(
      "initial generation retries twice, while regeneration fails once and keeps the old title",
      () =>
        Effect.gen(function* () {
          const real = yield* ChildProcessSpawner.ChildProcessSpawner;
          const clock = yield* Clock.Clock;
          const backoffs: Array<number> = [];
          const retryClock = {
            ...clock,
            sleep: (duration: Duration.Duration) => {
              const ms = Duration.toMillis(duration);
              return ms <= 4000
                ? Effect.sync(() => {
                    backoffs.push(ms);
                  })
                : clock.sleep(duration);
            },
          };
          let attempts = 0;
          const observed = ChildProcessSpawner.make((command) =>
            real.spawn(command).pipe(
              Effect.map((handle) => {
                const isTitle =
                  command._tag === "StandardCommand" &&
                  (command.args.includes("exec") ||
                    command.command.replaceAll("^", "").includes('"exec"'));
                if (!isTitle) return handle;
                attempts += 1;
                return handle;
              }),
            ),
          );
          const h = yield* makeHarness(`
        const args=process.argv.slice(2);
        if(args.includes('mcp')) console.log('[]');
        else if(args[0] === 'exec') { for await(const chunk of process.stdin) {} process.exitCode=1; }
      `).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, observed));
          yield* sendFileCreateMessage(h);
          yield* h.worker.drain.pipe(Effect.provideService(Clock.Clock, retryClock));
          assert.deepStrictEqual(backoffs, [2000, 4000]);
          assert.strictEqual(attempts, 3);
          const threadId = FILE_CREATE_IDS.threadId;
          const initial = Option.getOrThrow(
            yield* h.orchestrator.getThreadProjection(threadId),
          ).thread;
          assert.isNull(initial.titleRegeneration);
          yield* h.orchestrator.dispatch({
            type: "thread.metadata.update",
            commandId: CommandId.make("retry-regenerate"),
            threadId,
            regenerateTitle: true,
          });
          yield* h.worker.drain;
          assert.strictEqual(attempts, 4);
          const after = Option.getOrThrow(
            yield* h.orchestrator.getThreadProjection(threadId),
          ).thread;
          assert.strictEqual(after.title, initial.title);
          assert.isNull(after.titleRegeneration);
        }).pipe(Effect.scoped),
    );
    it.effect(
      "a claimed title survives process loss while its provider turn finishes independently",
      () =>
        Effect.gen(function* () {
          const config = yield* makeTestServerConfig();
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const real = yield* ChildProcessSpawner.ChildProcessSpawner;
          const gated = ChildProcessSpawner.make((command) => {
            const title =
              command._tag === "StandardCommand" &&
              (command.args.includes("exec") ||
                command.command.replaceAll("^", "").includes('"exec"'));
            return title
              ? Effect.andThen(
                  Deferred.succeed(entered, undefined),
                  Effect.andThen(Deferred.await(release), real.spawn(command)),
                )
              : real.spawn(command);
          });
          const scope = yield* Scope.make();
          const first = yield* makeHarness(undefined, config).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, gated),
            Scope.provide(scope),
          );
          const { sent } = yield* sendFileCreateMessage(first);
          const daemon = yield* first.worker.runDaemon.pipe(Effect.forkIn(scope));
          yield* Deferred.await(entered);
          const run = yield* first.awaitRunEnded(FILE_CREATE_IDS.threadId, sent.sequence);
          assert.strictEqual(run.status, "completed");
          assert.isNotNull(
            Option.getOrThrow(
              yield* first.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
            ).thread.titleRegeneration,
          );
          yield* Fiber.interrupt(daemon);
          yield* Scope.close(scope, Exit.void);
          const restarted = yield* makeHarness(
            `
        import { writeFileSync } from 'node:fs';
        const args = process.argv.slice(2);
        if(args.includes('mcp')) console.log('[]');
        else if(args[0] === 'exec') { for await (const chunk of process.stdin) {} writeFileSync(args[args.indexOf('--output-last-message')+1], '{"title":"Recovered greeting title"}'); }
      `,
            config,
            true,
          );
          assert.strictEqual(yield* restarted.worker.drain, 1);
          const thread = Option.getOrThrow(
            yield* restarted.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
          ).thread;
          assert.strictEqual(thread.title, "Recovered greeting title");
          assert.isNull(thread.titleRegeneration);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "newer requests, explicit cancellation, archive and delete defeat old completions",
      () =>
        Effect.gen(function* () {
          const h = yield* makeHarness();
          yield* sendFileCreateMessage(h);
          const threadId = FILE_CREATE_IDS.threadId;
          const initial = Option.getOrThrow(yield* h.orchestrator.getThreadProjection(threadId))
            .thread.titleRegeneration!.requestId;
          const requestId = CommandId.make("regenerate");
          const command = {
            type: "thread.metadata.update" as const,
            threadId,
            commandId: requestId,
            regenerateTitle: true,
          };
          const first = yield* h.orchestrator.dispatch(command);
          assert.deepStrictEqual(yield* h.orchestrator.dispatch(command), first);
          yield* h.orchestrator.dispatch({
            type: "thread.title.regeneration.complete",
            threadId,
            commandId: CommandId.make("old-complete"),
            requestId: initial,
            title: "Stale title",
          });
          assert.strictEqual(
            Option.getOrThrow(yield* h.orchestrator.getThreadProjection(threadId)).thread
              .titleRegeneration?.requestId,
            requestId,
          );
          yield* h.orchestrator.dispatch({
            type: "thread.metadata.update",
            threadId,
            commandId: CommandId.make("cancel-title"),
            regenerateTitle: false,
          });
          yield* h.orchestrator.dispatch({
            type: "thread.title.regeneration.complete",
            threadId,
            commandId: CommandId.make("cancelled-complete"),
            requestId,
            title: "Cancelled title",
          });
          assert.notStrictEqual(
            Option.getOrThrow(yield* h.orchestrator.getThreadProjection(threadId)).thread.title,
            "Cancelled title",
          );
          for (const action of ["thread.archive", "thread.delete"] as const) {
            const next = CommandId.make(`regenerate:${action}`);
            yield* h.orchestrator.dispatch({ ...command, commandId: next });
            yield* h.orchestrator.dispatch({
              type: action,
              threadId,
              commandId: CommandId.make(action),
            });
            assert.isNull(
              Option.getOrThrow(yield* h.orchestrator.getThreadProjection(threadId)).thread
                .titleRegeneration,
            );
          }
        }).pipe(Effect.scoped),
    );
    it.effect("the worker replaces the seed with a generated title and completes the marker", () =>
      Effect.gen(function* () {
        const h = yield* makeHarness(`
        import { writeFileSync } from 'node:fs';
        const args = process.argv.slice(2);
        if (args.includes('mcp')) console.log('[]');
        else if(args[0] === 'exec') { for await (const chunk of process.stdin) {} writeFileSync(args[args.indexOf('--output-last-message')+1], '{"title":"Create greeting file"}'); }
      `);
        yield* sendFileCreateMessage(h);
        yield* h.worker.drain;
        const thread = Option.getOrThrow(
          yield* h.orchestrator.getThreadProjection(FILE_CREATE_IDS.threadId),
        ).thread;
        assert.strictEqual(thread.title, "Create greeting file");
        assert.isNull(thread.titleRegeneration);
      }).pipe(Effect.scoped),
    );
    it.effect("the first message seeds a title and a rename defeats its late generated title", () =>
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* sendFileCreateMessage(h);
        const threadId = FILE_CREATE_IDS.threadId;
        const before = Option.getOrThrow(
          yield* h.orchestrator.getThreadProjection(threadId),
        ).thread;
        assert.isNotNull(before.titleRegeneration);
        const requestId = before.titleRegeneration!.requestId;
        yield* h.orchestrator.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make("rename"),
          threadId,
          title: "My chosen name",
        });
        yield* h.orchestrator.dispatch({
          type: "thread.title.regeneration.complete",
          commandId: CommandId.make("late"),
          threadId,
          requestId,
          title: "Generated name",
        });
        const after = Option.getOrThrow(yield* h.orchestrator.getThreadProjection(threadId)).thread;
        assert.strictEqual(after.title, "My chosen name");
        assert.isNull(after.titleRegeneration);
      }).pipe(Effect.scoped),
    );
  });
});

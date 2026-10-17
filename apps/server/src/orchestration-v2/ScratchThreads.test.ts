import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";

describe("scratch thread commands", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "runs a scratch thread and its title in its own first-message folder, retries once, and keeps files after deletion",
      () =>
        Effect.gen(function* () {
          const cwd = yield* Deferred.make<string>();
          const h = yield* makeOrchestrationHarness({
            claudeRunner: {
              allocateSessionId: Effect.succeed("scratch-session"),
              open: (input) =>
                Effect.andThen(Deferred.succeed(cwd, input.options.cwd!), Effect.never),
            },
            titleCliSource: `import {writeFileSync} from 'node:fs';
            const args = process.argv.slice(2);
            if (args.includes('mcp')) console.log('[]');
            else if(args[0] === 'exec') { for await (const chunk of process.stdin) {}
              writeFileSync('title-cwd.txt', process.cwd());
              writeFileSync(args[args.indexOf('--output-last-message')+1], JSON.stringify({title:'Cozy frog bakery'}));
            } else if(args.includes('--version')) console.log('codex-cli 0.120.0');
            else if(args.includes('status')) console.log('Logged in using ChatGPT');`,
          });
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const projectId = ProjectId.make("scratch-project");
          const threadId = ThreadId.make("thread:scratch12345678");
          yield* h.projects.create({
            commandId: CommandId.make("project"),
            projectId,
            title: "No project",
            workspaceRoot: path.join(h.home, "scratch"),
            createWorkspaceRootIfMissing: true,
          });
          yield* h.orchestrator.dispatch({
            type: "thread.create",
            commandId: CommandId.make("create"),
            threadId,
            projectId,
            title: "New thread",
            modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
          });
          const message = {
            type: "message.dispatch" as const,
            commandId: CommandId.make("send"),
            threadId,
            messageId: MessageId.make("message"),
            text: "Build a cozy frog bakery",
            titleSeed: "Build a cozy frog bakery",
          };
          yield* h.orchestrator.dispatch(message);
          const thread = Option.getOrThrow(
            yield* h.orchestrator.getThreadProjection(threadId),
          ).thread;
          assert.isString(thread.worktreePath);
          const folder = thread.worktreePath!;
          assert.strictEqual(path.dirname(folder), path.join(h.home, "scratch"));
          assert.match(path.basename(folder), /-build-a-cozy-frog-bakery-12345678$/);
          yield* h.orchestrator.dispatch(message);
          assert.strictEqual((yield* fs.readDirectory(path.join(h.home, "scratch"))).length, 1);
          yield* h.worker.runDaemon.pipe(Effect.forkScoped);
          assert.strictEqual(yield* Deferred.await(cwd), folder);
          yield* h.eventStore.streamApplicationEvents({ afterSequence: 0 }).pipe(
            Stream.filter(
              (stored) =>
                stored.aggregateKind === "thread" &&
                stored.event.type === "thread.metadata-updated" &&
                stored.event.payload.title === "Cozy frog bakery",
            ),
            Stream.take(1),
            Stream.runDrain,
          );
          assert.strictEqual(
            yield* fs.readFileString(path.join(folder, "title-cwd.txt")),
            yield* fs.realPath(folder),
          );
          yield* h.orchestrator.dispatch({
            type: "thread.delete",
            commandId: CommandId.make("delete"),
            threadId,
          });
          assert.isTrue(yield* fs.exists(path.join(folder, "title-cwd.txt")));
        }).pipe(Effect.scoped),
      { timeout: 10000 },
    );
  });
});

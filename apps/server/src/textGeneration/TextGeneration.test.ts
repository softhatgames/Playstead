import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { writeFakeCli } from "@playstead/provider-testing/fakeCli";
import * as HostProcess from "@playstead/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { makeCliTextGeneration } from "./CliTextGeneration.ts";

// Real child processes, including .cmd launchers on Windows. Stubs check the public CLI contract.
const checks = `
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
let prompt = ''; for await (const chunk of process.stdin) prompt += chunk;
`;
describe("title generation CLI", () => {
  it.layer(NodeServices.layer)((it) => {
    for (const driver of ["codex", "claudeAgent"] as const) {
      it.effect(`${driver} rejects malformed structured output`, () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "bad-title-" });
          const binaryPath = yield* writeFakeCli({
            directory,
            name: driver,
            source:
              checks +
              `
if(args.includes('mcp')) console.log('[]');
else if(args[0] === 'exec') writeFileSync(value('--output-last-message'), '{"title":42}');
else console.log('{"structured_output":{"title":42}}');`,
          });
          const generator = yield* makeCliTextGeneration({
            driver,
            binaryPath,
            platform: yield* HostProcess.Platform,
            environment: yield* HostProcess.Environment,
          });
          const error = yield* Effect.flip(
            generator.generateThreadTitle({
              cwd: directory,
              message: "Task",
              modelSelection: { instanceId: driver, model: "title-model" },
            }),
          );
          assert.strictEqual(error._tag, "TextGenerationError");
        }).pipe(Effect.scoped),
      );
    }
    it.effect("Claude prefers its structured error over wrapper stderr", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "claude-error-" });
        const binaryPath = yield* writeFakeCli({
          directory,
          name: "claude",
          source: `console.error('wrapper notice'); console.log(JSON.stringify({is_error:true,result:'Please sign in'})); process.exitCode=1;`,
        });
        const generator = yield* makeCliTextGeneration({
          driver: "claudeAgent",
          binaryPath,
          platform: yield* HostProcess.Platform,
          environment: yield* HostProcess.Environment,
        });
        const error = yield* Effect.flip(
          generator.generateThreadTitle({
            cwd: directory,
            message: "Task",
            modelSelection: { instanceId: "claudeAgent", model: "haiku" },
          }),
        );
        assert.include(error.detail, "Please sign in");
        assert.notInclude(error.detail, "wrapper notice");
      }).pipe(Effect.scoped),
    );
    it.effect("Claude runs in an isolated directory with tools, hooks and MCP disabled", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "claude title spaces-" });
        const binaryPath = yield* writeFakeCli({
          directory,
          name: "claude",
          source:
            checks +
            `
assert.equal(args[0], '-p'); assert.equal(value('--output-format'), 'json');
assert.equal(value('--model'), 'claude-haiku-5-5'); assert.equal(value('--tools'), '');
assert.equal(value('--permission-mode'), 'dontAsk'); assert.ok(args.includes('--strict-mcp-config'));
assert.ok(args.includes('--disable-slash-commands'));
assert.equal(JSON.parse(value('--settings')).disableAllHooks, true);
assert.ok(process.cwd().includes('playstead-claude-title-'));
assert.ok(prompt.includes('Previous conversation'));
console.log(JSON.stringify([{type:'result',structured_output:{title:'  Better jumping  '}}]));`,
        });
        const generator = yield* makeCliTextGeneration({
          driver: "claudeAgent",
          binaryPath,
          platform: yield* HostProcess.Platform,
          environment: yield* HostProcess.Environment,
        });
        assert.deepStrictEqual(
          yield* generator.generateThreadTitle({
            cwd: directory,
            message: "Previous conversation",
            modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
          }),
          { title: "Better jumping" },
        );
      }).pipe(Effect.scoped),
    );
    it.effect(
      "Codex uses read-only ephemeral exec, disables plugins and named MCP servers, and sends effort",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "title cli spaces-" });
          const binaryPath = yield* writeFakeCli({
            directory,
            name: "codex",
            source:
              checks +
              `
if (args.includes('mcp')) { console.log(JSON.stringify([{name:'server.with.dots',enabled:true}])); }
else {
 assert.equal(args[0], 'exec'); assert.ok(args.includes('--ephemeral'));
 assert.equal(value('-s'), 'read-only'); assert.ok(args.includes('--skip-git-repo-check'));
 assert.ok(args.includes('features.plugins=false')); assert.ok(args.includes('features.apps=false'));
 assert.ok(args.includes('mcp_servers={"server.with.dots"={enabled=false}}'));
 assert.ok(args.includes('model_reasoning_effort="low"'));
 assert.equal(value('--model'), 'gpt-6-luna'); assert.ok(prompt.includes('Make jumping better'));
 assert.equal(JSON.parse(readFileSync(value('--output-schema'),'utf8')).type,'object');
 writeFileSync(value('--output-last-message'), JSON.stringify({title:'"Improve jumping"\\nExtra'}));
}`,
          });
          const generate = yield* makeCliTextGeneration({
            driver: "codex",
            binaryPath,
            platform: yield* HostProcess.Platform,
            environment: yield* HostProcess.Environment,
          });
          assert.deepStrictEqual(
            yield* generate.generateThreadTitle({
              cwd: directory,
              message: "Make jumping better",
              modelSelection: {
                instanceId: "codex",
                model: "gpt-6-luna",
                options: [{ id: "reasoningEffort", value: "low" }],
              },
            }),
            { title: "Improve jumping" },
          );
        }).pipe(Effect.scoped),
    );
  });
});

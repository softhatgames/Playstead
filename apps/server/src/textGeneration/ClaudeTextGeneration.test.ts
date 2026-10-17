// @effect-diagnostics preferSchemaOverJson:off -- The fake CLI's script and log are plain JSON.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import { writeFakeCli } from "@playstead/provider-testing/fakeCli";
import * as HostProcess from "@playstead/shared/hostProcess";
import { makeTempDirectoryScoped } from "@playstead/shared/tempDirectory";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";

import { makeClaudeTextGeneration } from "./ClaudeTextGeneration.ts";

/**
 * Seam 2 for Claude's titles: the real text generation runs a fake `claude`
 * that logs how it was started and prints what it is told to, as T3 Code's
 * `ClaudeTextGeneration.test.ts` and its fixture at 2577baf do.
 */

interface FakeClaudeInput {
  /** What `claude -p --output-format json` prints. */
  readonly stdout: string;
  readonly exitCode?: number;
  readonly stderr?: string;
}

interface FakeClaudeStart {
  readonly args: ReadonlyArray<string>;
  readonly stdin: string;
  readonly cwd: string;
}

const fakeClaudeSource = (input: FakeClaudeInput, log: string) => `
import * as NodeFS from "node:fs";
const input = ${JSON.stringify(input)};
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const stdin = Buffer.concat(chunks).toString("utf8");
NodeFS.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), stdin, cwd: process.cwd() }) + "\\n");
if (input.stderr !== undefined) process.stderr.write(input.stderr + "\\n");
process.stdout.write(input.stdout);
process.exitCode = input.exitCode ?? 0;
`;

const MODEL: ModelSelection = { instanceId: "claudeAgent", model: "claude-haiku-5-5" };

const answer = (structured: unknown) =>
  JSON.stringify({ type: "result", is_error: false, structured_output: structured });

const withFakeClaude = <A, E, R>(
  input: FakeClaudeInput,
  use: (
    textGeneration: Effect.Success<ReturnType<typeof makeClaudeTextGeneration>>,
    context: {
      readonly cwd: string;
      readonly start: Effect.Effect<
        FakeClaudeStart,
        PlatformError.PlatformError,
        FileSystem.FileSystem
      >;
    },
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* makeTempDirectoryScoped("playstead-claude-text-");
    const log = path.join(directory, "starts.ndjson");
    const cwd = path.join(directory, "game");
    yield* fs.makeDirectory(cwd);
    const binaryPath = yield* writeFakeCli({
      directory: path.join(directory, "bin"),
      name: "claude",
      source: fakeClaudeSource(input, log),
    });
    const textGeneration = yield* makeClaudeTextGeneration({
      binaryPath,
      environment: yield* HostProcess.Environment,
      platform: yield* HostProcess.Platform,
    });
    const start = Effect.map(
      fs.readFileString(log),
      (text) => JSON.parse(text.trim().split("\n")[0]!) as FakeClaudeStart,
    );
    return yield* use(textGeneration, { cwd, start });
  }).pipe(Effect.scoped);

const valueAfter = (args: ReadonlyArray<string>, flag: string) => args[args.indexOf(flag) + 1];

describe("Claude text generation", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "titles a thread with claude -p: JSON schema output, no tools, hooks or slash commands, dontAsk, outside the project",
      () =>
        withFakeClaude(
          { stdout: answer({ title: "Moon level jump height", needsRefinement: false }) },
          (textGeneration, { cwd, start }) =>
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const generated = yield* textGeneration.generateThreadTitle({
                cwd,
                message: "Make the player jump higher on the moon level",
                modelSelection: MODEL,
              });
              assert.deepStrictEqual(generated, { title: "Moon level jump height" });

              const { args, stdin, cwd: ranIn } = yield* start;
              assert.strictEqual(args[0], "-p");
              assert.strictEqual(valueAfter(args, "--output-format"), "json");
              const schema = JSON.parse(valueAfter(args, "--json-schema")!) as {
                readonly required: ReadonlyArray<string>;
              };
              assert.deepStrictEqual(schema.required, ["title", "needsRefinement"]);
              assert.strictEqual(valueAfter(args, "--model"), "claude-haiku-5-5");
              assert.notInclude(args, "--effort");
              assert.deepStrictEqual(JSON.parse(valueAfter(args, "--settings")!), {
                disableAllHooks: true,
              });
              assert.strictEqual(valueAfter(args, "--tools"), "");
              assert.include(args, "--disable-slash-commands");
              assert.strictEqual(valueAfter(args, "--permission-mode"), "dontAsk");
              assert.notInclude(args, "--dangerously-skip-permissions");
              assert.include(stdin, "User message:\nMake the player jump higher");
              // A scoped folder of its own, gone once it has answered.
              const path = yield* Path.Path;
              assert.match(path.basename(ranIn), /^playstead-claude-title-/);
              assert.isFalse(yield* fs.exists(ranIn));
            }),
        ),
    );

    it.effect("keeps the person's MCP servers out unless a managed config already does", () =>
      withFakeClaude({ stdout: answer({ title: "Any title" }) }, (textGeneration, { cwd, start }) =>
        Effect.gen(function* () {
          yield* textGeneration.generateThreadTitle({
            cwd,
            message: "Name it",
            modelSelection: MODEL,
          });
          // No managed-mcp.json on a test machine.
          assert.include((yield* start).args, "--strict-mcp-config");
        }),
      ),
    );

    it.effect("asks for the chosen effort, thinking and fast mode", () =>
      withFakeClaude(
        { stdout: answer({ title: "Effortful title" }) },
        (textGeneration, { cwd, start }) =>
          Effect.gen(function* () {
            yield* textGeneration.generateThreadTitle({
              cwd,
              message: "Name it",
              modelSelection: {
                ...MODEL,
                options: [
                  { id: "effort", value: "high" },
                  { id: "thinking", value: false },
                  { id: "fastMode", value: true },
                ],
              },
            });
            const { args } = yield* start;
            assert.strictEqual(valueAfter(args, "--effort"), "high");
            assert.deepStrictEqual(JSON.parse(valueAfter(args, "--settings")!), {
              disableAllHooks: true,
              alwaysThinkingEnabled: false,
              fastMode: true,
            });
          }),
      ),
    );

    it.effect("reads the result from a stream of messages too", () =>
      withFakeClaude(
        {
          stdout: JSON.stringify([
            { type: "system", subtype: "init" },
            { type: "result", structured_output: { title: "Streamed title" } },
          ]),
        },
        (textGeneration, { cwd }) =>
          Effect.gen(function* () {
            const generated = yield* textGeneration.generateThreadTitle({
              cwd,
              message: "Name it",
              modelSelection: MODEL,
            });
            assert.strictEqual(generated.title, "Streamed title");
          }),
      ),
    );

    it.effect('gives "New thread" for a title of whitespace', () =>
      withFakeClaude({ stdout: answer({ title: "   " }) }, (textGeneration, { cwd }) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateThreadTitle({
            cwd,
            message: "Name it",
            modelSelection: MODEL,
          });
          assert.strictEqual(generated.title, "New thread");
        }),
      ),
    );

    it.effect("fails when Claude's structured output does not match the schema", () =>
      withFakeClaude({ stdout: answer({ name: "wrong key" }) }, (textGeneration, { cwd }) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            textGeneration.generateThreadTitle({ cwd, message: "Name it", modelSelection: MODEL }),
          );
          assert.strictEqual(error.detail, "Claude returned invalid structured output.");
        }),
      ),
    );

    it.effect("fails with the error Claude reports on stdout when it exits with one", () =>
      withFakeClaude(
        {
          stdout: JSON.stringify({ type: "result", is_error: true, result: "Not logged in" }),
          stderr: "a wrapper's notice",
          exitCode: 1,
        },
        (textGeneration, { cwd }) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(
              textGeneration.generateThreadTitle({
                cwd,
                message: "Name it",
                modelSelection: MODEL,
              }),
            );
            assert.strictEqual(error.detail, "Claude CLI command failed: Not logged in");
          }),
      ),
    );
  });
});

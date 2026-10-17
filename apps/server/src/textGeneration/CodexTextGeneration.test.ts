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

import { makeCodexTextGeneration } from "./CodexTextGeneration.ts";

/**
 * Seam 2 for Codex's titles: the real text generation runs a fake `codex`
 * that logs how it was started and answers as told, as T3 Code's
 * `CodexTextGeneration.test.ts` at 2577baf does.
 */

interface FakeCodexInput {
  /** What `--output-last-message` gets. */
  readonly output: string;
  readonly exitCode?: number;
  readonly stderr?: string;
  /** What `codex mcp list --json` prints, or the code it exits with. */
  readonly mcpServers?:
    | ReadonlyArray<{ readonly name: string; readonly enabled: boolean }>
    | number;
}

interface FakeCodexStart {
  readonly args: ReadonlyArray<string>;
  readonly stdin: string;
  readonly cwd: string;
}

const fakeCodexSource = (input: FakeCodexInput, log: string) => `
import * as NodeFS from "node:fs";
const input = ${JSON.stringify(input)};
const args = process.argv.slice(2);
if (args.includes("mcp") && args.includes("list")) {
  NodeFS.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, stdin: "", cwd: process.cwd() }) + "\\n");
  if (typeof input.mcpServers === "number") process.exit(input.mcpServers);
  process.stdout.write(JSON.stringify(input.mcpServers ?? []));
  process.exit(0);
}
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const stdin = Buffer.concat(chunks).toString("utf8");
NodeFS.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, stdin, cwd: process.cwd() }) + "\\n");
const outputPath = args[args.indexOf("--output-last-message") + 1];
if (input.stderr !== undefined) process.stderr.write(input.stderr + "\\n");
if ((input.exitCode ?? 0) === 0) NodeFS.writeFileSync(outputPath, input.output + "\\n");
process.exitCode = input.exitCode ?? 0;
`;

const MODEL: ModelSelection = { instanceId: "codex", model: "gpt-6-luna" };

const withFakeCodex = <A, E, R>(
  input: FakeCodexInput,
  use: (
    textGeneration: Effect.Success<ReturnType<typeof makeCodexTextGeneration>>,
    context: {
      readonly cwd: string;
      readonly starts: Effect.Effect<
        ReadonlyArray<FakeCodexStart>,
        PlatformError.PlatformError,
        FileSystem.FileSystem
      >;
    },
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* makeTempDirectoryScoped("playstead-codex-text-");
    const log = path.join(directory, "starts.ndjson");
    const cwd = path.join(directory, "game");
    yield* fs.makeDirectory(cwd);
    const binaryPath = yield* writeFakeCli({
      directory: path.join(directory, "bin"),
      name: "codex",
      source: fakeCodexSource(input, log),
    });
    const textGeneration = yield* makeCodexTextGeneration({
      binaryPath,
      environment: yield* HostProcess.Environment,
      platform: yield* HostProcess.Platform,
    });
    const starts = Effect.map(fs.readFileString(log), (text) =>
      text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as FakeCodexStart),
    );
    return yield* use(textGeneration, { cwd, starts });
  }).pipe(Effect.scoped);

/** The value after each `--config`. */
const configValues = (args: ReadonlyArray<string>) =>
  args.flatMap((arg, index) => (args[index - 1] === "--config" ? [arg] : []));

describe("Codex text generation", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "titles a thread with codex exec: ephemeral, read-only, plugins and apps off, the prompt on stdin",
      () =>
        withFakeCodex(
          { output: JSON.stringify({ title: '  "Moon level jump height"  \nignored line' }) },
          (textGeneration, { cwd, starts }) =>
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const generated = yield* textGeneration.generateThreadTitle({
                cwd,
                message: "Make the player jump higher on the moon level",
                modelSelection: MODEL,
              });
              assert.deepStrictEqual(generated, { title: "Moon level jump height" });

              const exec = (yield* starts).find((start) => start.args[0] === "exec");
              assert.isDefined(exec);
              const args = exec!.args;
              assert.strictEqual(args.at(-1), "-");
              for (const flag of ["--ephemeral", "--skip-git-repo-check"]) {
                assert.include(args, flag);
              }
              assert.strictEqual(args[args.indexOf("-s") + 1], "read-only");
              assert.strictEqual(args[args.indexOf("--model") + 1], "gpt-6-luna");
              assert.deepStrictEqual(configValues(args), [
                "features.plugins=false",
                "features.apps=false",
                'model_reasoning_effort="low"',
              ]);
              assert.include(exec!.stdin, "User message:\nMake the player jump higher");
              assert.strictEqual(yield* fs.realPath(exec!.cwd), yield* fs.realPath(cwd));
              // The schema and answer files are gone once it has answered.
              const schemaPath = args[args.indexOf("--output-schema") + 1]!;
              assert.isFalse(yield* fs.exists(schemaPath));
            }),
        ),
    );

    it.effect("turns the person's enabled MCP servers off by name", () =>
      withFakeCodex(
        {
          output: JSON.stringify({ title: "Remove default sprites" }),
          mcpServers: [
            { name: "level-editor", enabled: true },
            { name: "my.server", enabled: true },
            { name: "already-off", enabled: false },
          ],
        },
        (textGeneration, { cwd, starts }) =>
          Effect.gen(function* () {
            yield* textGeneration.generateThreadTitle({
              cwd,
              message: "Remove the default sprites. Use the level-editor MCP when you start.",
              modelSelection: MODEL,
            });
            const all = yield* starts;
            const list = all.find((start) => start.args.includes("mcp"));
            assert.deepStrictEqual(list?.args, [
              "--config",
              "features.plugins=false",
              "--config",
              "features.apps=false",
              "mcp",
              "list",
              "--json",
            ]);
            const exec = all.find((start) => start.args[0] === "exec");
            assert.include(
              configValues(exec!.args),
              'mcp_servers={"level-editor"={enabled=false},"my.server"={enabled=false}}',
            );
          }),
      ),
    );

    it.effect("still titles the thread when Codex cannot list its MCP servers", () =>
      withFakeCodex(
        { output: JSON.stringify({ title: "Remove default sprites" }), mcpServers: 2 },
        (textGeneration, { cwd, starts }) =>
          Effect.gen(function* () {
            const generated = yield* textGeneration.generateThreadTitle({
              cwd,
              message: "Remove the default sprites",
              modelSelection: MODEL,
            });
            assert.strictEqual(generated.title, "Remove default sprites");
            const exec = (yield* starts).find((start) => start.args[0] === "exec");
            assert.isFalse(
              configValues(exec!.args).some((value) => value.startsWith("mcp_servers")),
            );
          }),
      ),
    );

    it.effect("asks for the chosen reasoning effort and service tier", () =>
      withFakeCodex(
        { output: JSON.stringify({ title: "Faster title" }) },
        (textGeneration, { cwd, starts }) =>
          Effect.gen(function* () {
            yield* textGeneration.generateThreadTitle({
              cwd,
              message: "Name this thread",
              modelSelection: {
                instanceId: "codex",
                model: "gpt-6-luna",
                options: [
                  { id: "reasoningEffort", value: "medium" },
                  { id: "serviceTier", value: "fast" },
                ],
              },
            });
            const exec = (yield* starts).find((start) => start.args[0] === "exec");
            assert.includeMembers(configValues(exec!.args), [
              'model_reasoning_effort="medium"',
              'service_tier="fast"',
            ]);
          }),
      ),
    );

    it.effect("passes the refinement flag on when the subject is still unknown", () =>
      withFakeCodex(
        { output: JSON.stringify({ title: "Investigate issue", needsRefinement: true }) },
        (textGeneration, { cwd }) =>
          Effect.gen(function* () {
            assert.deepStrictEqual(
              yield* textGeneration.generateThreadTitle({
                cwd,
                message: "Fix this",
                modelSelection: MODEL,
              }),
              { title: "Investigate issue", needsRefinement: true },
            );
          }),
      ),
    );

    it.effect('gives "New thread" when nothing is left of the title', () =>
      withFakeCodex(
        { output: JSON.stringify({ title: '  """   """  ' }) },
        (textGeneration, { cwd }) =>
          Effect.gen(function* () {
            const generated = yield* textGeneration.generateThreadTitle({
              cwd,
              message: "Name this thread",
              modelSelection: MODEL,
            });
            assert.strictEqual(generated.title, "New thread");
          }),
      ),
    );

    it.effect("fails when Codex answers with something other than the schema", () =>
      withFakeCodex({ output: "not json" }, (textGeneration, { cwd }) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            textGeneration.generateThreadTitle({ cwd, message: "Name it", modelSelection: MODEL }),
          );
          assert.strictEqual(error.detail, "Codex returned invalid structured output.");
        }),
      ),
    );

    it.effect("fails with what Codex printed when it exits with an error", () =>
      withFakeCodex(
        { output: "", exitCode: 1, stderr: "You are not signed in." },
        (textGeneration, { cwd }) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(
              textGeneration.generateThreadTitle({
                cwd,
                message: "Name it",
                modelSelection: MODEL,
              }),
            );
            assert.strictEqual(error.detail, "Codex CLI command failed: You are not signed in.");
          }),
      ),
    );
  });
});

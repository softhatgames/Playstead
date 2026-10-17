import {
  type ProviderTextGeneration,
  TextGenerationError,
  type ThreadTitleInput,
} from "@playstead/provider-core/server/textGeneration";
import {
  buildThreadTitlePrompt,
  sanitizeThreadTitle,
  ThreadTitleOutput,
} from "@playstead/provider-core/server/threadTitle";
import { resolveSpawnCommand, type ProcessEnvironment } from "@playstead/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const outputSchema = encodeJson({
  type: "object",
  properties: { title: { type: "string" }, needsRefinement: { type: "boolean" } },
  required: ["title", "needsRefinement"],
  additionalProperties: false,
});
const decodeTitle = Schema.decodeUnknownEffect(Schema.fromJsonString(ThreadTitleOutput));
const decodeServers = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Array(Schema.Struct({ name: Schema.String, enabled: Schema.Boolean })),
  ),
);
const ClaudeEnvelope = Schema.Struct({
  structured_output: Schema.optionalKey(ThreadTitleOutput),
  is_error: Schema.optionalKey(Schema.Boolean),
  result: Schema.optionalKey(Schema.String),
});
const decodeClaude = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Union([ClaudeEnvelope, Schema.Array(ClaudeEnvelope)])),
);
const noPlugins = ["--config", "features.plugins=false", "--config", "features.apps=false"];

/** One-shot CLI processes, following CodexTextGeneration/ClaudeTextGeneration at T3 Code 2577baf. */
export const makeCliTextGeneration = Effect.fn("makeCliTextGeneration")(function* (config: {
  readonly driver: "codex" | "claudeAgent";
  readonly binaryPath: string;
  readonly environment: ProcessEnvironment;
  readonly platform: NodeJS.Platform;
}) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const run = Effect.fn("TextGeneration.run")(
    function* (args: ReadonlyArray<string>, cwd: string, prompt: string) {
      const command = yield* resolveSpawnCommand(config.binaryPath, args, {
        env: config.environment,
        platform: config.platform,
      });
      const child = yield* spawner.spawn(
        ChildProcess.make(command.command, command.args, {
          cwd,
          env: config.environment,
          shell: command.shell,
          stdin: { stream: Stream.encodeText(Stream.make(prompt)) },
        }),
      );
      const [stdout, stderr, code] = yield* Effect.all(
        [
          child.stdout.pipe(Stream.decodeText(), Stream.mkString),
          child.stderr.pipe(Stream.decodeText(), Stream.mkString),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      if (config.driver === "claudeAgent") {
        const envelope = yield* decodeClaude(stdout).pipe(
          Effect.orElseSucceed((): ReadonlyArray<typeof ClaudeEnvelope.Type> => []),
        );
        const messages = Schema.is(ClaudeEnvelope)(envelope) ? [envelope] : envelope;
        const error = messages.findLast((message) => message.is_error && message.result?.trim());
        if (error)
          return yield* new TextGenerationError({ detail: `Claude CLI failed: ${error.result}` });
      }
      if (code !== 0)
        return yield* new TextGenerationError({
          detail: `${config.driver} CLI failed: ${stderr.trim() || stdout.trim() || code}`,
        });
      return stdout;
    },
    Effect.scoped,
    Effect.provideService(FileSystem.FileSystem, fs),
  );
  const generateThreadTitle = Effect.fn("TextGeneration.generateThreadTitle")(
    function* (input: ThreadTitleInput) {
      const prompt = buildThreadTitlePrompt(input);
      if (config.driver === "claudeAgent") {
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "playstead-claude-title-" });
        const effort = input.modelSelection.options?.find((o) => o.id === "effort")?.value;
        const output = yield* run(
          [
            "-p",
            "--output-format",
            "json",
            "--json-schema",
            outputSchema,
            "--model",
            input.modelSelection.model,
            ...(typeof effort === "string" ? ["--effort", effort] : []),
            "--settings",
            encodeJson({ disableAllHooks: true }),
            "--tools",
            "",
            "--disable-slash-commands",
            "--strict-mcp-config",
            "--permission-mode",
            "dontAsk",
          ],
          cwd,
          prompt,
        ).pipe(Effect.flatMap(decodeClaude));
        const messages = Schema.is(ClaudeEnvelope)(output) ? [output] : output;
        const title = messages.findLast(
          (message) => message.structured_output !== undefined,
        )?.structured_output;
        if (!title)
          return yield* new TextGenerationError({
            detail: "Claude returned invalid structured output.",
          });
        return { title: sanitizeThreadTitle(title.title) };
      }
      const servers = yield* run([...noPlugins, "mcp", "list", "--json"], input.cwd, "").pipe(
        Effect.flatMap(decodeServers),
        Effect.timeout("10 seconds"),
        Effect.catch(() =>
          Effect.logWarning(
            "Codex MCP list failed; generating with plugin and app overrides only.",
          ).pipe(Effect.as([])),
        ),
      );
      const enabled = servers.filter((s) => s.enabled);
      const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "playstead-codex-title-" });
      const schemaPath = `${temporary}/schema.json`;
      const outputPath = `${temporary}/title.json`;
      yield* fs.writeFileString(schemaPath, outputSchema);
      const effort =
        input.modelSelection.options?.find((o) => o.id === "reasoningEffort")?.value ?? "low";
      yield* run(
        [
          "exec",
          ...noPlugins,
          ...(enabled.length
            ? [
                "--config",
                `mcp_servers={${enabled.map((s) => `${encodeJson(s.name)}={enabled=false}`).join(",")}}`,
              ]
            : []),
          "--ephemeral",
          "--skip-git-repo-check",
          "-s",
          "read-only",
          "--model",
          input.modelSelection.model,
          "--config",
          `model_reasoning_effort=${encodeJson(effort)}`,
          "--output-schema",
          schemaPath,
          "--output-last-message",
          outputPath,
          "-",
        ],
        input.cwd,
        prompt,
      );
      const output = yield* decodeTitle(yield* fs.readFileString(outputPath));
      return { title: sanitizeThreadTitle(output.title) };
    },
    Effect.scoped,
    Effect.timeout("180 seconds"),
    Effect.mapError((cause) =>
      Schema.is(TextGenerationError)(cause)
        ? cause
        : new TextGenerationError({
            detail: `${config.driver} title generation failed: ${cause.message}`,
            cause,
          }),
    ),
  );
  return { generateThreadTitle } satisfies ProviderTextGeneration;
});

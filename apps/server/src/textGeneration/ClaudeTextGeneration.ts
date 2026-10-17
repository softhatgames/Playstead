import { TextGenerationError } from "@playstead/provider-core/server/textGeneration";
import * as TextGenerationOperations from "@playstead/provider-core/server/textGenerationOperations";
import {
  normalizeCliError,
  toJsonSchemaObject,
} from "@playstead/provider-core/server/textGenerationUtils";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@playstead/shared/model";
import { type ProcessEnvironment, resolveSpawnCommand } from "@playstead/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/**
 * Claude's text generation, following T3 Code's
 * `apps/server/src/textGeneration/ClaudeTextGeneration.ts` at 2577baf: one
 * `claude -p` per request with the prompt on stdin and a JSON schema for
 * the answer, with no tools, hooks, slash commands or MCP servers, in
 * `dontAsk` mode. A title is generated in a scoped folder of its own, not
 * the project. It runs the instance's own `claude` (its **Binary path**)
 * through Playstead's spawning, with the server's environment. T3 Code's
 * investigation tools, Claude home and model catalog are absent: the chosen
 * effort, thinking and fast mode go to the CLI as chosen.
 */

const CLAUDE_TIMEOUT_MS = 180_000;

/** Claude refuses `--strict-mcp-config` beside a managed MCP config, which keeps the person's servers out itself. */
const managedMcpConfigPath = (platform: NodeJS.Platform) =>
  platform === "darwin"
    ? "/Library/Application Support/ClaudeCode/managed-mcp.json"
    : platform === "win32"
      ? "C:\\Program Files\\ClaudeCode\\managed-mcp.json"
      : "/etc/claude-code/managed-mcp.json";

const ClaudeOutputEnvelope = Schema.Struct({ structured_output: Schema.Unknown });
const ClaudeOutputMessage = Schema.Struct({
  type: Schema.String,
  structured_output: Schema.optionalKey(Schema.Unknown),
});
const isClaudeOutputEnvelope = Schema.is(ClaudeOutputEnvelope);
const decodeClaudeOutput = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Union([ClaudeOutputEnvelope, Schema.Array(ClaudeOutputMessage)])),
);
const isClaudeErrorResult = Schema.is(
  Schema.Struct({ is_error: Schema.Literal(true), result: Schema.String }),
);
const decodeJsonOption = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

/**
 * The error a failed run reports on stdout. Stderr may hold only a
 * wrapper's notices, so this is preferred when present.
 */
function claudeErrorResult(stdout: string): string | undefined {
  const output = Option.getOrUndefined(decodeJsonOption(stdout));
  const messages: ReadonlyArray<unknown> = Array.isArray(output) ? output : [output];
  return messages
    .filter(isClaudeErrorResult)
    .map((message) => message.result.trim())
    .findLast((result) => result.length > 0);
}

const collect = <E>(operation: string, stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.mkString,
    Effect.mapError((cause) =>
      normalizeCliError("claude", operation, cause, "Failed to collect process output"),
    ),
  );

export const makeClaudeTextGeneration = Effect.fn("makeClaudeTextGeneration")(function* (input: {
  readonly binaryPath: string;
  readonly environment: ProcessEnvironment;
  readonly platform: NodeJS.Platform;
}) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const env = { ...input.environment };

  const encode = (operation: string, value: unknown, detail: string) =>
    encodeJson(value).pipe(
      Effect.mapError((cause) => new TextGenerationError({ operation, detail, cause })),
    );

  const runClaudeJson: TextGenerationOperations.Runner = (request) =>
    Effect.gen(function* () {
      const { operation, cwd, prompt, outputSchema, modelSelection } = request;
      const schemaJson = yield* encode(
        operation,
        toJsonSchemaObject(outputSchema),
        "Failed to encode structured output schema.",
      );
      const effort = getModelSelectionStringOptionValue(modelSelection, "effort");
      const thinking = getModelSelectionBooleanOptionValue(modelSelection, "thinking");
      const fastMode = getModelSelectionBooleanOptionValue(modelSelection, "fastMode");
      const settingsJson = yield* encode(
        operation,
        {
          disableAllHooks: true,
          ...(thinking === undefined ? {} : { alwaysThinkingEnabled: thinking }),
          ...(fastMode === true ? { fastMode: true } : {}),
        },
        "Failed to encode Claude CLI settings.",
      );

      const stdout = yield* Effect.gen(function* () {
        const workingDirectory =
          operation === "generateThreadTitle"
            ? yield* fs
                .makeTempDirectoryScoped({ prefix: "playstead-claude-title-" })
                .pipe(
                  Effect.mapError((cause) =>
                    normalizeCliError(
                      "claude",
                      operation,
                      cause,
                      "Failed to create title directory",
                    ),
                  ),
                )
            : cwd;
        const managedMcpConfig = yield* fs
          .exists(managedMcpConfigPath(input.platform))
          .pipe(Effect.orElseSucceed(() => false));
        const command = yield* resolveSpawnCommand(
          input.binaryPath,
          [
            "-p",
            "--output-format",
            "json",
            "--json-schema",
            schemaJson,
            "--model",
            modelSelection.model,
            ...(effort === undefined ? [] : ["--effort", effort]),
            "--settings",
            settingsJson,
            "--tools",
            "",
            "--disable-slash-commands",
            ...(managedMcpConfig ? [] : ["--strict-mcp-config"]),
            "--permission-mode",
            "dontAsk",
          ],
          { platform: input.platform, env },
        );
        const child = yield* spawner
          .spawn(
            ChildProcess.make(command.command, command.args, {
              cwd: workingDirectory,
              env,
              extendEnv: false,
              shell: command.shell,
              stdin: { stream: Stream.encodeText(Stream.make(prompt)) },
            }),
          )
          .pipe(
            Effect.mapError((cause) =>
              normalizeCliError("claude", operation, cause, "Failed to spawn Claude CLI process"),
            ),
          );
        const [out, err, exitCode] = yield* Effect.all(
          [
            collect(operation, child.stdout),
            collect(operation, child.stderr),
            child.exitCode.pipe(
              Effect.mapError((cause) =>
                normalizeCliError(
                  "claude",
                  operation,
                  cause,
                  "Failed to read Claude CLI exit code",
                ),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );
        if (exitCode !== 0) {
          const detail =
            claudeErrorResult(out.trim()) ?? (err.trim().length > 0 ? err.trim() : out.trim());
          return yield* new TextGenerationError({
            operation,
            detail:
              detail.length > 0
                ? `Claude CLI command failed: ${detail}`
                : `Claude CLI command failed with code ${exitCode}.`,
          });
        }
        return out;
      }).pipe(
        Effect.scoped,
        Effect.timeoutOption(CLAUDE_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({ operation, detail: "Claude CLI request timed out." }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );

      const output = yield* decodeClaudeOutput(stdout).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation,
              detail: "Claude CLI returned unexpected output format.",
              cause,
            }),
        ),
      );
      const envelope = isClaudeOutputEnvelope(output)
        ? output
        : output.findLast((message) => message.type === "result");
      return yield* Schema.decodeUnknownEffect(outputSchema)(envelope?.structured_output).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation,
              detail: "Claude returned invalid structured output.",
              cause,
            }),
        ),
      );
    });

  return TextGenerationOperations.fromRunner("ClaudeTextGeneration", runClaudeJson);
});

import { DEFAULT_TEXT_GENERATION_REASONING_EFFORT } from "@playstead/contracts/settings";
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
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/**
 * Codex's text generation, following T3 Code's
 * `apps/server/src/textGeneration/CodexTextGeneration.ts` at 2577baf: one
 * `codex exec` per request, ephemeral and in a read-only sandbox, with the
 * prompt on stdin, the output schema in a file and the answer read from
 * `--output-last-message`. Plugins, apps and the person's MCP servers are
 * turned off so nothing acts on the prompt. It runs the instance's own
 * `codex` (its **Binary path**) through Playstead's spawning. T3 Code's
 * launch arguments, managed runtime, Codex home, image inputs and model
 * aliases are absent.
 */

const CODEX_TIMEOUT_MS = 180_000;
const CODEX_MCP_LIST_TIMEOUT_MS = 10_000;
/**
 * Plugins and apps bring MCP servers of their own; the person's own servers
 * are listed and turned off by name.
 */
const CODEX_NO_PLUGIN_ARGS = [
  "--config",
  "features.plugins=false",
  "--config",
  "features.apps=false",
] as const;

const decodeMcpServers = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Array(Schema.Struct({ name: Schema.String, enabled: Schema.Boolean })),
  ),
);
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

/**
 * `mcp_servers={}` merges into the person's servers rather than replacing
 * them, so each is named; quoting keeps a name with a dot one key.
 */
const mcpServersOff = (names: ReadonlyArray<string>): string | null =>
  names.length === 0
    ? null
    : `mcp_servers={${names.map((name) => `${JSON.stringify(name)}={enabled=false}`).join(",")}}`;

const collect = <E>(operation: string, stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.mkString,
    Effect.mapError((cause) =>
      normalizeCliError("codex", operation, cause, "Failed to collect process output"),
    ),
  );

export const makeCodexTextGeneration = Effect.fn("makeCodexTextGeneration")(function* (input: {
  readonly binaryPath: string;
  readonly environment: ProcessEnvironment;
  readonly platform: NodeJS.Platform;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const env = { ...input.environment };
  const target = { platform: input.platform, env };

  const spawn = (args: ReadonlyArray<string>, cwd: string, stdin?: string) =>
    Effect.gen(function* () {
      const command = yield* resolveSpawnCommand(input.binaryPath, args, target);
      return yield* spawner.spawn(
        ChildProcess.make(command.command, command.args, {
          cwd,
          env,
          extendEnv: false,
          shell: command.shell,
          ...(stdin === undefined
            ? {}
            : { stdin: { stream: Stream.encodeText(Stream.make(stdin)) } }),
        }),
      );
    });

  /** The person's enabled MCP servers; on any failure none, with a warning. */
  const listEnabledMcpServers = (cwd: string) =>
    Effect.gen(function* () {
      const child = yield* spawn([...CODEX_NO_PLUGIN_ARGS, "mcp", "list", "--json"], cwd);
      const [stdout, , exitCode] = yield* Effect.all(
        [
          child.stdout.pipe(Stream.decodeText(), Stream.mkString),
          child.stderr.pipe(Stream.runDrain),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      if (exitCode !== 0) return yield* Effect.fail(`exit ${exitCode}`);
      const servers = yield* decodeMcpServers(stdout);
      return servers.filter((server) => server.enabled).map((server) => server.name);
    }).pipe(
      Effect.scoped,
      Effect.timeoutOption(CODEX_MCP_LIST_TIMEOUT_MS),
      Effect.map(Option.getOrElse((): ReadonlyArray<string> => [])),
      Effect.catch((reason) =>
        Effect.logWarning("codex mcp list failed; text generation keeps its MCP servers").pipe(
          Effect.annotateLogs({ reason: String(reason) }),
          Effect.as<ReadonlyArray<string>>([]),
        ),
      ),
    );

  const runCodexJson: TextGenerationOperations.Runner = (request) =>
    Effect.gen(function* () {
      const { operation, cwd, prompt, outputSchema, modelSelection } = request;
      const schemaJson = yield* encodeJson(toJsonSchemaObject(outputSchema)).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation,
              detail: "Failed to encode structured output schema.",
              cause,
            }),
        ),
      );
      // Not scoped: titles run from the effect worker, whatever scope it has.
      const directory = yield* fs
        .makeTempDirectory({ prefix: "playstead-codex-" })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({ operation, detail: "Failed to write temp file", cause }),
          ),
        );
      const schemaPath = path.join(directory, "schema.json");
      const outputPath = path.join(directory, "output.json");

      const run = Effect.gen(function* () {
        yield* Effect.all([
          fs.writeFileString(schemaPath, schemaJson),
          fs.writeFileString(outputPath, ""),
        ]).pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({ operation, detail: "Failed to write temp file", cause }),
          ),
        );
        const reasoningEffort =
          getModelSelectionStringOptionValue(modelSelection, "reasoningEffort") ??
          DEFAULT_TEXT_GENERATION_REASONING_EFFORT;
        const serviceTier =
          getModelSelectionStringOptionValue(modelSelection, "serviceTier") ??
          (getModelSelectionBooleanOptionValue(modelSelection, "fastMode") === true
            ? "fast"
            : undefined);
        const serversOff = mcpServersOff(yield* listEnabledMcpServers(cwd));
        const child = yield* spawn(
          [
            "exec",
            ...CODEX_NO_PLUGIN_ARGS,
            ...(serversOff === null ? [] : ["--config", serversOff]),
            "--ephemeral",
            "--skip-git-repo-check",
            "-s",
            "read-only",
            "--model",
            modelSelection.model,
            "--config",
            `model_reasoning_effort="${reasoningEffort}"`,
            ...(serviceTier === undefined ? [] : ["--config", `service_tier="${serviceTier}"`]),
            "--output-schema",
            schemaPath,
            "--output-last-message",
            outputPath,
            "-",
          ],
          cwd,
          prompt,
        ).pipe(
          Effect.mapError((cause) =>
            normalizeCliError("codex", operation, cause, "Failed to spawn Codex CLI process"),
          ),
        );
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            collect(operation, child.stdout),
            collect(operation, child.stderr),
            child.exitCode.pipe(
              Effect.mapError((cause) =>
                normalizeCliError("codex", operation, cause, "Failed to read Codex CLI exit code"),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );
        if (exitCode !== 0) {
          const detail = stderr.trim().length > 0 ? stderr.trim() : stdout.trim();
          return yield* new TextGenerationError({
            operation,
            detail:
              detail.length > 0
                ? `Codex CLI command failed: ${detail}`
                : `Codex CLI command failed with code ${exitCode}.`,
          });
        }
      }).pipe(
        Effect.scoped,
        Effect.timeoutOption(CODEX_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({ operation, detail: "Codex CLI request timed out." }),
              ),
            onSome: () => Effect.void,
          }),
        ),
      );

      return yield* run.pipe(
        Effect.andThen(
          fs.readFileString(outputPath).pipe(
            Effect.mapError(
              (cause) =>
                new TextGenerationError({
                  operation,
                  detail: "Failed to read Codex output file.",
                  cause,
                }),
            ),
          ),
        ),
        Effect.flatMap((text) =>
          Schema.decodeEffect(Schema.fromJsonString(outputSchema))(text).pipe(
            Effect.mapError(
              (cause) =>
                new TextGenerationError({
                  operation,
                  detail: "Codex returned invalid structured output.",
                  cause,
                }),
            ),
          ),
        ),
        Effect.ensuring(fs.remove(directory, { recursive: true }).pipe(Effect.ignore)),
      );
    });

  return TextGenerationOperations.fromRunner("CodexTextGeneration", runCodexJson);
});

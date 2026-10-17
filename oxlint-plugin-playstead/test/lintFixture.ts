import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as NodeModule from "node:module";

// oxlint comes with Vite+, not as a dependency of its own, so find it through
// vite-plus instead of assuming where pnpm placed it.
const oxlintPackageJson = NodeModule.createRequire(
  NodeModule.createRequire(import.meta.url).resolve("vite-plus/package.json"),
).resolve("oxlint/package.json");

const encodeConfig = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const readAll = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (text, chunk) => text + chunk,
    ),
  );

export interface LintResult {
  readonly exitCode: number;
  readonly output: string;
}

/**
 * Lints one source file with only `rule` turned on, through the real oxlint
 * and Playstead's plugin, in a temporary folder.
 */
export const lintFixture = Effect.fn("lintFixture")(function* (
  rule: string,
  source: string,
  options: { readonly filename?: string } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const pluginRoot = path.join(import.meta.dirname, "..");
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "playstead-oxlint-" });
  const configPath = path.join(folder, ".oxlintrc.json");
  const sourcePath = path.join(folder, options.filename ?? "fixture.ts");

  yield* fs.writeFileString(
    configPath,
    yield* encodeConfig({
      jsPlugins: [{ name: "playstead", specifier: path.join(pluginRoot, "index.ts") }],
      rules: { [rule]: "error" },
    }),
  );
  yield* fs.writeFileString(sourcePath, source);

  // oxlint's bin is an extensionless script, which Windows cannot start by
  // itself, so run it with this Node.
  const oxlintBin = path.join(path.dirname(oxlintPackageJson), "bin", "oxlint");
  const child = yield* spawner.spawn(
    ChildProcess.make(process.execPath, [oxlintBin, "--config", configPath, sourcePath], {
      cwd: pluginRoot,
    }),
  );
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [readAll(child.stdout), readAll(child.stderr), child.exitCode],
    { concurrency: "unbounded" },
  );
  return { exitCode: Number(exitCode), output: stdout + stderr } satisfies LintResult;
}, Effect.scoped);

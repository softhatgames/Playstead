#!/usr/bin/env node
/**
 * Vendors Effect's source into `.repos/effect-smol` with `git subtree`, at the
 * version the workspace catalog pins, so agents can read the library they
 * write against. Run it after bumping `effect`: `vp run sync:repos`.
 * `--latest` takes Effect's main branch instead; `--dry-run` only prints.
 *
 * Follows T3 Code's scripts/sync-reference-repos.ts at 2577baf.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Yaml from "yaml";

interface ReferenceRepo {
  readonly id: string;
  readonly prefix: string;
  readonly repository: string;
  readonly latestRef: string;
  /** The catalog entry whose version names the tag to vendor. */
  readonly catalogPackage: string;
  readonly tagPrefix: string;
}

const referenceRepos: ReadonlyArray<ReferenceRepo> = [
  {
    id: "effect-smol",
    prefix: ".repos/effect-smol",
    repository: "https://github.com/Effect-TS/effect.git",
    latestRef: "main",
    catalogPackage: "effect",
    tagPrefix: "effect@",
  },
];

export class ReferenceRepoVersionError extends Schema.TaggedError<ReferenceRepoVersionError>()(
  "ReferenceRepoVersionError",
  { repoId: Schema.String, sourcePath: Schema.String, cause: Schema.Defect() },
) {
  override get message() {
    return `No catalog version for reference repo "${this.repoId}" in ${this.sourcePath}.`;
  }
}

export class ReferenceRepoGitError extends Schema.TaggedError<ReferenceRepoGitError>()(
  "ReferenceRepoGitError",
  { repoId: Schema.String, exitCode: Schema.Number },
) {
  override get message() {
    return `git subtree for reference repo "${this.repoId}" exited with ${this.exitCode}.`;
  }
}

const WorkspaceCatalog = Schema.Struct({
  catalog: Schema.Record(Schema.String, Schema.String),
});
const decodeWorkspaceCatalog = Schema.decodeUnknownEffect(WorkspaceCatalog);

interface ReferenceRepoSyncPlan {
  readonly repo: ReferenceRepo;
  readonly args: ReadonlyArray<string>;
}

const resolveRef = Effect.fn("resolveRef")(function* (
  repo: ReferenceRepo,
  rootDir: string,
  latest: boolean,
) {
  if (latest) return repo.latestRef;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sourcePath = path.join(rootDir, "pnpm-workspace.yaml");
  const failed = (cause: unknown) =>
    new ReferenceRepoVersionError({ repoId: repo.id, sourcePath, cause });

  const text = yield* fs.readFileString(sourcePath).pipe(Effect.mapError(failed));
  const parsed = yield* Effect.try({ try: () => Yaml.parse(text) as unknown, catch: failed });
  const { catalog } = yield* decodeWorkspaceCatalog(parsed).pipe(Effect.mapError(failed));
  const version = catalog[repo.catalogPackage];
  if (version === undefined) {
    return yield* failed(`catalog has no ${repo.catalogPackage}`);
  }
  return `${repo.tagPrefix}${version}`;
});

/** What `git subtree` would run for each reference repo, without running it. */
export const planReferenceRepoSync = Effect.fn("planReferenceRepoSync")(function* (options: {
  readonly rootDir: string;
  readonly latest?: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const plans: Array<ReferenceRepoSyncPlan> = [];
  for (const repo of referenceRepos) {
    const exists = yield* fs.exists(path.join(options.rootDir, repo.prefix));
    const ref = yield* resolveRef(repo, options.rootDir, options.latest ?? false);
    plans.push({
      repo,
      args: [
        "subtree",
        exists ? "pull" : "add",
        `--prefix=${repo.prefix}`,
        repo.repository,
        ref,
        "--squash",
      ],
    });
  }
  return plans;
});

const runGit = Effect.fn("runGit")(function* (rootDir: string, plan: ReferenceRepoSyncPlan) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make("git", plan.args, { cwd: rootDir, stdout: "inherit", stderr: "inherit" }),
  );
  const exitCode = Number(yield* child.exitCode);
  if (exitCode !== 0) {
    return yield* new ReferenceRepoGitError({ repoId: plan.repo.id, exitCode });
  }
}, Effect.scoped);

const main = Effect.fn("syncReferenceRepos")(function* (argv: ReadonlyArray<string>) {
  const path = yield* Path.Path;
  const rootDir = path.join(import.meta.dirname, "..");
  const dryRun = argv.includes("--dry-run");
  const plans = yield* planReferenceRepoSync({ rootDir, latest: argv.includes("--latest") });
  for (const plan of plans) {
    yield* Console.log(`git ${plan.args.join(" ")}`);
    if (!dryRun) yield* runGit(rootDir, plan);
  }
});

if (import.meta.main) {
  main(process.argv.slice(2)).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}

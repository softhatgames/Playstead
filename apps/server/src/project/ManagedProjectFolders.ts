import type { ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";

/** The project of threads without a project is titled this. */
export const SCRATCH_PROJECT_TITLE = "No project";

export class ScratchUnavailableError extends Schema.TaggedError<ScratchUnavailableError>()(
  "ScratchUnavailableError",
  {},
) {
  override get message(): string {
    return "Threads without a project are not available on this environment.";
  }
}

export class ScratchFolderError extends Schema.TaggedError<ScratchFolderError>()(
  "ScratchFolderError",
  { folder: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to create the folder for threads without a project.";
  }
}

export class ScratchProjectError extends Schema.TaggedError<ScratchProjectError>()(
  "ScratchProjectError",
  { workspaceRoot: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to create the project for threads without a project.";
  }
}

export type ScratchError = ScratchUnavailableError | ScratchFolderError | ScratchProjectError;

/**
 * The folders Playstead manages for threads without a project (T3 Code's
 * `apps/server/src/project/ManagedProjectFolders.ts` at 2577baf, its
 * Scratch half). "No project" is an ordinary project whose folder is
 * `<Playstead home>/scratch`, offered only while the home is outside every
 * Git checkout: inside one, each thread's folder would land in that
 * repository. A missing Git counts as outside. Each of the project's
 * threads gets a folder of its own under it, named from its first message.
 *
 * Creating the project itself is `ProjectService.ensureScratchProject`,
 * since the orchestrator, which the project service needs, asks this for
 * thread folders.
 */
export class ManagedProjectFolders extends Context.Service<
  ManagedProjectFolders,
  {
    /** `<home>/scratch`, or none inside a Git checkout. Checked once. */
    readonly scratchRoot: Effect.Effect<Option.Option<string>>;
    /** Makes the scratch folder, again if it was deleted. */
    readonly makeScratchRoot: (root: string) => Effect.Effect<void, ScratchFolderError>;
    /**
     * Claims a new folder for a thread of the "No project" project; none for
     * any other project's thread, or when "No project" is unavailable.
     */
    readonly folderForThread: (input: {
      readonly projectId: ProjectId;
      readonly threadId: ThreadId;
      readonly text: string;
    }) => Effect.Effect<Option.Option<string>, ScratchFolderError>;
  }
>()("@playstead/server/project/ManagedProjectFolders") {}

/** The first five words of the message, lower-case, at most 48 characters. */
const folderWords = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 5)
    .join("-")
    .slice(0, 48)
    .replace(/-+$/, "");

const GIT_PROBE_TIMEOUT = Duration.seconds(5);

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const projects = yield* ProjectStore.ProjectStoreV2;

  /** T3 Code's `GitVcsDriver.isInsideWorkTree`: `git rev-parse --is-inside-work-tree`. */
  const isInsideGitCheckout = (cwd: string) =>
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make("git", ["rev-parse", "--is-inside-work-tree"], {
          cwd,
          stdin: "ignore",
          stderr: "ignore",
        }),
      );
      const [stdout, exitCode] = yield* Effect.all(
        [child.stdout.pipe(Stream.decodeText(), Stream.mkString), child.exitCode],
        { concurrency: "unbounded" },
      );
      return exitCode === 0 && stdout.trim() === "true";
    }).pipe(Effect.scoped, Effect.timeout(GIT_PROBE_TIMEOUT));

  // Spawning a `git` that is not on PATH fails with NotFound, on Windows too.
  const isGitMissing = (error: unknown) =>
    PlatformError.isPlatformError(error) && error.reason._tag === "NotFound";

  // Any other failure leaves "No project" unavailable, as T3 Code's does.
  const [probe, invalidate] = yield* Effect.cachedInvalidateWithTTL(
    isInsideGitCheckout(config.baseDir).pipe(
      Effect.catchIf(isGitMissing, () => Effect.succeed(false)),
      Effect.map((inside) =>
        inside ? Option.none<string>() : Option.some(path.resolve(config.baseDir, "scratch")),
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.succeed(Option.none<string>()),
      ),
    ),
    Duration.infinity,
  );
  const scratchRoot = probe.pipe(Effect.onInterrupt(() => invalidate));

  const makeScratchRoot = (root: string) =>
    fileSystem
      .makeDirectory(root, { recursive: true })
      .pipe(Effect.mapError((cause) => new ScratchFolderError({ folder: root, cause })));

  const isScratchProject = (projectId: ProjectId, root: string) =>
    projects.get(projectId).pipe(
      Effect.map(
        Option.exists((project) => path.resolve(project.workspaceRoot) === path.resolve(root)),
      ),
      Effect.orElseSucceed(() => false),
    );

  /**
   * Each folder is made without `recursive`, so making it is the claim: of
   * two racers for one name, one gets AlreadyExists and tries the next.
   */
  const claimFolder = (folder: string) =>
    fileSystem.makeDirectory(folder).pipe(
      Effect.as(true),
      Effect.catchIf(
        (error) => error.reason._tag === "AlreadyExists",
        () => Effect.succeed(false),
      ),
      Effect.mapError((cause) => new ScratchFolderError({ folder, cause })),
    );

  const folderForThread: ManagedProjectFolders["Service"]["folderForThread"] = Effect.fn(
    "ManagedProjectFolders.folderForThread",
  )(function* (input) {
    const root = yield* scratchRoot;
    if (Option.isNone(root)) return Option.none();
    if (!(yield* isScratchProject(input.projectId, root.value))) return Option.none();
    const date = DateTime.formatIso(yield* DateTime.now).slice(0, 10);
    const words = folderWords(input.text);
    const id = input.threadId.toLowerCase().replace(/[^a-z0-9]/g, "");
    const folderFor = (idPart: string) =>
      path.join(root.value, [date, words, idPart].filter(Boolean).join("-"));
    yield* makeScratchRoot(root.value);
    // The id's last 8 characters, then the whole id, then the id and a uuid.
    const full = folderFor(id);
    for (let attempt = 1; ; attempt++) {
      const folder =
        attempt === 1
          ? folderFor(id.slice(-8))
          : attempt === 2
            ? full
            : `${full}-${(yield* crypto
                .randomUUIDv4()
                .pipe(
                  Effect.mapError((cause) => new ScratchFolderError({ folder: full, cause })),
                )).slice(0, 8)}`;
      if (yield* claimFolder(folder)) return Option.some(folder);
    }
  });

  return ManagedProjectFolders.of({ scratchRoot, makeScratchRoot, folderForThread });
});

export const layer = Layer.effect(ManagedProjectFolders, make);

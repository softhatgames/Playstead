import * as DateTime from "effect/DateTime";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Stream from "effect/Stream";
import { CommandId, ProjectId, type ThreadId } from "@playstead/contracts/baseSchemas";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ServerConfig } from "../config.ts";
import { ProjectService } from "./ProjectService.ts";

export class ScratchError extends Schema.TaggedError<ScratchError>()("ScratchError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class ManagedProjectFolders extends Context.Service<
  ManagedProjectFolders,
  {
    readonly folderForThread: (input: {
      readonly projectId: ProjectId;
      readonly threadId: ThreadId;
      readonly text: string;
    }) => Effect.Effect<Option.Option<string>, ScratchError>;
    readonly scratchRoot: Effect.Effect<Option.Option<string>>;
    readonly ensureScratchProject: Effect.Effect<{ readonly projectId: ProjectId }, ScratchError>;
  }
>()("@playstead/server/project/ManagedProjectFolders") {}

export const layer = Layer.effect(
  ManagedProjectFolders,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const projects = yield* ProjectService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const scratchRoot = yield* Effect.cached(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(
          ChildProcess.make("git", ["-C", config.baseDir, "rev-parse", "--is-inside-work-tree"], {
            env: { LC_ALL: "C" },
            extendEnv: true,
          }),
        );
        const [code, output, error] = yield* Effect.all(
          [
            child.exitCode,
            Stream.mkString(Stream.decodeText(child.stdout)),
            Stream.mkString(Stream.decodeText(child.stderr)),
          ],
          { concurrency: "unbounded" },
        );
        const outside =
          (code === 0 && output.trim() === "false") ||
          (code !== 0 && error.includes("not a git repository"));
        return outside
          ? Option.some(path.resolve(config.baseDir, "scratch"))
          : Option.none<string>();
      }).pipe(
        Effect.scoped,
        Effect.timeout("10 seconds"),
        Effect.catch((error) =>
          Effect.succeed(
            error._tag === "PlatformError" && error.reason._tag === "NotFound"
              ? Option.some(path.resolve(config.baseDir, "scratch"))
              : Option.none<string>(),
          ),
        ),
      ),
    );
    const ensureScratchProject = Effect.gen(function* () {
      const root = yield* scratchRoot;
      if (Option.isNone(root))
        return yield* new ScratchError({
          message: "Threads without a project are not available in this environment.",
        });
      yield* fs.makeDirectory(root.value, { recursive: true });
      const existing = (yield* projects.listShells).find(
        (p) => path.resolve(p.workspaceRoot) === root.value,
      );
      if (existing) return { projectId: existing.id };
      const id = yield* crypto.randomUUIDv4();
      const project = yield* projects
        .create({
          commandId: CommandId.make(`scratch-project:${id}`),
          projectId: ProjectId.make(id),
          title: "No project",
          workspaceRoot: root.value,
        })
        .pipe(
          Effect.catchTag("ProjectConflictError", (error) =>
            Effect.succeed({ id: error.conflictingProjectId }),
          ),
        );
      return { projectId: project.id };
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ScratchError({
            message: "Could not prepare the project for threads without a project.",
            cause,
          }),
      ),
    );
    const folderForThread = Effect.fn("ManagedProjectFolders.folderForThread")(
      function* (input: {
        readonly projectId: ProjectId;
        readonly threadId: ThreadId;
        readonly text: string;
      }) {
        const root = yield* scratchRoot;
        if (Option.isNone(root)) return Option.none<string>();
        const project = yield* projects.getShell(input.projectId);
        if (Option.isNone(project) || path.resolve(project.value.workspaceRoot) !== root.value)
          return Option.none<string>();
        yield* fs.makeDirectory(root.value, { recursive: true });
        const words = (input.text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
          .slice(0, 5)
          .join("-")
          .slice(0, 48)
          .replace(/-+$/, "");
        const date = DateTime.formatIso(yield* DateTime.now).slice(0, 10);
        const id = input.threadId.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (let attempt = 0; ; attempt++) {
          const suffix =
            attempt === 0
              ? id.slice(-8)
              : attempt === 1
                ? id
                : `${id}-${(yield* crypto.randomUUIDv4()).slice(0, 8)}`;
          const folder = path.join(root.value, [date, words, suffix].filter(Boolean).join("-"));
          const claimed = yield* fs.makeDirectory(folder).pipe(
            Effect.as(true),
            Effect.catchIf(
              (error) => error.reason._tag === "AlreadyExists",
              () => Effect.succeed(false),
            ),
          );
          if (claimed) return Option.some(folder);
        }
      },
      Effect.mapError(
        (cause) => new ScratchError({ message: "Could not create the thread folder.", cause }),
      ),
    );
    return ManagedProjectFolders.of({ scratchRoot, ensureScratchProject, folderForThread });
  }),
);

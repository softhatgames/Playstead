import { CommandId, type MessageId, type ThreadId } from "@playstead/contracts/baseSchemas";
import { formatThreadTitleContext } from "@playstead/provider-core/server/threadTitleContext";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectStore from "./ProjectStore.ts";

export type ThreadTitleRequestKind =
  | { readonly type: "initial"; readonly messageId: MessageId }
  | { readonly type: "regenerate" };

/**
 * Writes a thread's title for its `thread-title.generate` effect, following
 * T3 Code's `apps/server/src/orchestration-v2/ThreadTitleRegenerationService.ts`
 * at 2577baf.
 *
 * - A request that is no longer the thread's (renamed, archived, deleted or
 *   asked again since) does nothing.
 * - A first title reads the first message; a regenerate reads the
 *   conversation through `formatThreadTitleContext`, with the current title.
 * - The provider is the **Text generation** setting's, run in the project's
 *   folder.
 * - "New thread", or a regenerate that gives the same title, keeps the title.
 * - A first title is tried twice more after a failure, waiting 2 s and then
 *   4 s; a regenerate is not. A failure is logged and keeps the title.
 * - Every request still current ends with the internal
 *   `thread.title.regeneration.complete`, which applies only if it still is.
 */
export class ThreadTitleRegenerationService extends Context.Service<
  ThreadTitleRegenerationService,
  {
    readonly execute: (input: {
      readonly threadId: ThreadId;
      readonly requestId: CommandId;
      readonly kind: ThreadTitleRequestKind;
    }) => Effect.Effect<void, DispatchRefused>;
  }
>()("@playstead/server/orchestration-v2/ThreadTitleRegenerationService") {}

type DispatchRefused = Effect.Error<ReturnType<Orchestrator.OrchestratorV2["Service"]["dispatch"]>>;

type Outcome = { readonly type: "stale" } | { readonly type: "complete"; readonly title?: string };

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;

  const execute: ThreadTitleRegenerationService["Service"]["execute"] = Effect.fn(
    "ThreadTitleRegenerationService.execute",
  )(function* (input) {
    const outcome: Outcome = yield* Effect.gen(function* () {
      const found = yield* orchestrator.getThreadProjection(input.threadId);
      if (Option.isNone(found)) return { type: "stale" } as const;
      const projection = found.value;
      const { thread } = projection;
      if (thread.titleRegeneration?.requestId !== input.requestId) {
        return { type: "stale" } as const;
      }
      const project = yield* projects.get(thread.projectId);
      if (Option.isNone(project)) return { type: "complete" } as const;

      const finished = projection.messages.filter((message) => !message.streaming);
      const kind = input.kind;
      const message =
        kind.type === "initial"
          ? (finished.find((candidate) => candidate.id === kind.messageId)?.text ?? "")
          : formatThreadTitleContext(finished).message;
      if (message.length === 0) return { type: "complete" } as const;

      const { textGenerationModelSelection } = yield* settings.getSettings;
      const result = yield* textGeneration.generateThreadTitle({
        cwd: thread.worktreePath ?? project.value.workspaceRoot,
        message,
        ...(kind.type === "regenerate" ? { previousTitle: thread.title } : {}),
        modelSelection: textGenerationModelSelection,
      });
      const generated = result.title.trim();
      return generated === "New thread" ||
        (kind.type === "regenerate" && generated === thread.title.trim())
        ? ({ type: "complete" } as const)
        : ({ type: "complete", title: result.title } as const);
    }).pipe(
      Effect.retry({
        times: input.kind.type === "initial" ? 2 : 0,
        schedule: Schedule.exponential("2 seconds"),
      }),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("Thread title generation failed").pipe(
              Effect.annotateLogs({
                threadId: input.threadId,
                requestId: input.requestId,
                cause: Cause.pretty(cause),
              }),
              Effect.as<Outcome>({ type: "complete" }),
            ),
      ),
    );
    if (outcome.type === "stale") return;
    yield* orchestrator.dispatch({
      type: "thread.title.regeneration.complete",
      commandId: CommandId.make(`${input.requestId}:title-complete`),
      threadId: input.threadId,
      requestId: input.requestId,
      ...(outcome.title === undefined ? {} : { title: outcome.title }),
    });
  });

  return ThreadTitleRegenerationService.of({ execute });
});

export const layer = Layer.effect(ThreadTitleRegenerationService, make);

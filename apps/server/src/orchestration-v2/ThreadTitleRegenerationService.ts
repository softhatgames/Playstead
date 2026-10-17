import * as Cause from "effect/Cause";
import { CommandId, type ThreadId } from "@playstead/contracts/baseSchemas";
import { formatThreadTitleContext } from "@playstead/provider-core/server/threadTitle";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  TextGeneration,
  resolveTextGenerationModelSelection,
} from "../textGeneration/TextGeneration.ts";
import type { OrchestrationEffectRequestV2 } from "./EffectOutbox.ts";
import { OrchestratorV2, type OrchestratorDispatchError } from "./Orchestrator.ts";
import type { OrchestrationDispatchCommandError } from "@playstead/contracts/orchestrationV2";
import { ProjectStoreV2 } from "./ProjectStore.ts";

type TitleRequest = {
  readonly threadId: ThreadId;
  readonly requestId: CommandId;
  readonly kind: Extract<OrchestrationEffectRequestV2, { type: "thread-title.generate" }>["kind"];
};
export class ThreadTitleRegenerationService extends Context.Service<
  ThreadTitleRegenerationService,
  {
    readonly execute: (
      input: TitleRequest,
    ) => Effect.Effect<void, OrchestratorDispatchError | OrchestrationDispatchCommandError>;
  }
>()("@playstead/server/orchestration-v2/ThreadTitleRegenerationService") {}

/** Completion re-enters the orchestrator lock; only the request still current can change the title. */
export const layer = Layer.effect(
  ThreadTitleRegenerationService,
  Effect.gen(function* () {
    const threads = yield* OrchestratorV2;
    const projects = yield* ProjectStoreV2;
    const settings = yield* ServerSettingsService;
    const providers = yield* ProviderRegistry;
    const generation = yield* TextGeneration;
    return ThreadTitleRegenerationService.of({
      execute: Effect.fn("ThreadTitleRegenerationService.execute")(function* (input) {
        const result = yield* Effect.gen(function* () {
          const found = yield* threads.getThreadProjection(input.threadId);
          if (
            Option.isNone(found) ||
            found.value.thread.deletedAt !== null ||
            found.value.thread.titleRegeneration?.requestId !== input.requestId
          )
            return { stale: true };
          const { thread, messages } = found.value;
          const project = yield* projects.get(thread.projectId);
          if (Option.isNone(project)) return { stale: false };
          const kind = input.kind;
          const message =
            kind.type === "initial"
              ? (messages.find((m) => m.id === kind.messageId && !m.streaming)?.text ?? "")
              : formatThreadTitleContext(messages.filter((m) => !m.streaming));
          if (!message.trim()) return { stale: false };
          const modelSelection = resolveTextGenerationModelSelection(
            (yield* settings.getSettings).textGenerationModelSelection,
            yield* providers.getProviders,
          );
          const generated = yield* generation.generateThreadTitle({
            cwd: project.value.workspaceRoot,
            message,
            modelSelection,
            ...(kind.type === "regenerate" ? { previousTitle: thread.title } : {}),
          });
          return {
            stale: false,
            ...(generated.title === "New thread" || generated.title === thread.title
              ? {}
              : { title: generated.title }),
          };
        }).pipe(
          Effect.retry({
            times: input.kind.type === "initial" ? 2 : 0,
            schedule: Schedule.exponential("2 seconds"),
          }),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : Effect.logWarning("Thread title generation failed", {
                  threadId: input.threadId,
                  cause,
                }).pipe(Effect.as({ stale: false, title: undefined })),
          ),
        );
        if (result.stale) return;
        yield* threads.dispatch({
          type: "thread.title.regeneration.complete",
          commandId: CommandId.make(`${input.requestId}:title-complete`),
          threadId: input.threadId,
          requestId: input.requestId,
          ...(result.title === undefined ? {} : { title: result.title }),
        });
      }),
    });
  }),
);

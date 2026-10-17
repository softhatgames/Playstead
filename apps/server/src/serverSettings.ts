import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import type { ProviderInstanceMutation } from "@playstead/contracts/providerInstance";
import {
  DEFAULT_TEXT_GENERATION_MODELS,
  ServerSettings,
  ServerSettingsError,
} from "@playstead/contracts/settings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ServerConfig from "./config.ts";

/**
 * The server's settings, in `settings.json` in its state folder, following
 * T3 Code's `ServerSettingsService` (`apps/server/src/serverSettings.ts` at
 * 2577baf), for provider binary paths and the text generation selection.
 */
export class ServerSettingsService extends Context.Service<
  ServerSettingsService,
  {
    readonly updateAutoSettle: (
      days: number | null,
    ) => Effect.Effect<ServerSettings, ServerSettingsError>;
    readonly updateTextGeneration: (
      selection: ModelSelection,
    ) => Effect.Effect<ServerSettings, ServerSettingsError>;
    readonly getSettings: Effect.Effect<ServerSettings>;
    readonly updateProviderInstance: (
      mutation: ProviderInstanceMutation,
    ) => Effect.Effect<ServerSettings, ServerSettingsError>;
    /** The current settings, then each change. */
    readonly streamChanges: Stream.Stream<ServerSettings>;
  }
>()("@playstead/server/serverSettings/ServerSettingsService") {}

const DEFAULT_SETTINGS: ServerSettings = {
  sidebarAutoSettleAfterDays: 3,
  providerInstances: {},
  textGenerationModelSelection: DEFAULT_TEXT_GENERATION_MODELS.codex,
};

const SettingsJson = Schema.fromJsonString(ServerSettings);
const decodeSettings = Schema.decodeUnknownEffect(SettingsJson);
const encodeSettings = Schema.encodeEffect(SettingsJson);

/** An empty **Binary path** means the driver's default, so it is not kept. */
const applyMutation = (
  settings: ServerSettings,
  mutation: ProviderInstanceMutation,
): ServerSettings => {
  const binaryPath = mutation.instance.config?.binaryPath?.trim() ?? "";
  const instances = { ...settings.providerInstances };
  if (binaryPath.length === 0) {
    delete instances[mutation.instanceId];
  } else {
    instances[mutation.instanceId] = { driver: mutation.instance.driver, config: { binaryPath } };
  }
  return { ...settings, providerInstances: instances };
};

export const layer = Layer.effect(
  ServerSettingsService,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const read = fs.readFileString(config.settingsPath).pipe(
      Effect.flatMap(decodeSettings),
      Effect.map((saved) => ({
        ...saved,
        sidebarAutoSettleAfterDays:
          saved.sidebarAutoSettleAfterDays === undefined ? 3 : saved.sidebarAutoSettleAfterDays,
        textGenerationModelSelection:
          saved.textGenerationModelSelection ?? DEFAULT_TEXT_GENERATION_MODELS.codex,
      })),
      Effect.catchTag("PlatformError", (error) =>
        error.reason._tag === "NotFound" ? Effect.succeed(DEFAULT_SETTINGS) : Effect.fail(error),
      ),
      Effect.catch((error) =>
        Effect.logWarning("Ignoring unreadable settings; using the defaults.").pipe(
          Effect.annotateLogs({ settingsPath: config.settingsPath, error: String(error) }),
          Effect.as(DEFAULT_SETTINGS),
        ),
      ),
    );

    /** A temporary file and a rename, so a crash never leaves half a file. */
    const write = (settings: ServerSettings) =>
      Effect.gen(function* () {
        const text = yield* encodeSettings(settings);
        const temporary = `${config.settingsPath}.${process.pid}.tmp`;
        yield* fs.makeDirectory(path.dirname(config.settingsPath), { recursive: true });
        yield* fs.writeFileString(temporary, `${text}\n`);
        yield* fs.rename(temporary, config.settingsPath);
      }).pipe(
        Effect.mapError(
          (error) =>
            new ServerSettingsError({ detail: `Could not save settings: ${error.message}` }),
        ),
      );

    const settings = yield* SubscriptionRef.make(yield* read);
    const writes = yield* Semaphore.make(1);

    return ServerSettingsService.of({
      getSettings: SubscriptionRef.get(settings),
      updateAutoSettle: (days) =>
        Effect.gen(function* () {
          const next = {
            ...(yield* SubscriptionRef.get(settings)),
            sidebarAutoSettleAfterDays: days,
          };
          yield* write(next);
          yield* SubscriptionRef.set(settings, next);
          return next;
        }).pipe(writes.withPermit),
      updateTextGeneration: (selection) =>
        Effect.gen(function* () {
          const next = {
            ...(yield* SubscriptionRef.get(settings)),
            textGenerationModelSelection: selection,
          };
          yield* write(next);
          yield* SubscriptionRef.set(settings, next);
          return next;
        }).pipe(writes.withPermit),
      updateProviderInstance: (mutation) =>
        Effect.gen(function* () {
          if (mutation.instance.driver !== mutation.instanceId) {
            return yield* new ServerSettingsError({
              detail: `Provider instance ${mutation.instanceId} cannot use the ${mutation.instance.driver} driver.`,
            });
          }
          const next = applyMutation(yield* SubscriptionRef.get(settings), mutation);
          yield* write(next);
          yield* SubscriptionRef.set(settings, next);
          return next;
        }).pipe(writes.withPermit),
      streamChanges: SubscriptionRef.changes(settings),
    });
  }),
);
